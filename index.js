import express from "express-promise-router";
import { auth } from 'express-oauth2-jwt-bearer';
import { metricTrigger, getStationHistoryDataChart, metricTriggerOptions, isMetricLimitCrossed, cacheStats } from './semsportal.js';
import { notifyIFTTT } from './ifttt-realtime.js';

const IFTTT_SERVICE_KEY = process.env.IFTTT_SERVICE_KEY;

const timeoutByTriggerId = {};
const svcAccessTokenByUserId = {};

export const api = express();

process.on('exit', function () {
    const timeouts = Object.values(timeoutByTriggerId);
    console.log(`Deleting ${timeouts.length} trigger timeouts before exiting`);
    timeouts.forEach((timeout) => {
        clearTimeout(timeout);
    });
});

function serviceKeyCheck(req, res, next) {
    if (IFTTT_SERVICE_KEY !== req.get("IFTTT-Service-Key")) {
        const err = Error('Invalid service key');
        err.status = 401;
        next(err);
    } else {
        next();
    }
}

const jwtCheck = auth({
    audience: 'semsportal-ifttt',
    issuerBaseURL: 'https://dev-4wnwsvy10pt0430e.us.auth0.com/',
    tokenSigningAlg: 'RS256'
});

api.use(function requestLogger(req, res, next) {
    console.log('<req ' + req.method + ' IFTTT ' + req.path + '<:', req.headers, req.body);
    next();
});

api.use(function responseLogger(req, res, next) {
    let send = res.send;
    res.send = (content) => {
        console.log('>res ' + res.statusCode + ' IFTTT ' + req.path + '>:', content ? JSON.stringify(content) : '');
        res.send = send;
        return res.send(content);
    }
    next();
});

api.get('/ifttt/v1/status', serviceKeyCheck, status);
api.post('/ifttt/v1/test/setup', serviceKeyCheck, testSetup);
api.get('/ifttt/v1/user/info', jwtCheck, userInfo);

api.post('/ifttt/v1/triggers/metric_drops_below_limit', jwtCheck, metricTriggerAndTimer);
api.post('/ifttt/v1/triggers/metric_drops_below_limit/fields/inverter_metric_id/options', jwtCheck, metricTriggerOptions);
api.delete('/ifttt/v1/triggers/metric_drops_below_limit/trigger_identity/:triggerId', jwtCheck, deleteTrigger);

api.post('/ifttt/v1/triggers/metric_exceeds_limit', jwtCheck, metricTriggerAndTimer);
api.post('/ifttt/v1/triggers/metric_exceeds_limit/fields/inverter_metric_id/options', jwtCheck, metricTriggerOptions);
api.delete('/ifttt/v1/triggers/metric_exceeds_limit/trigger_identity/:triggerId', jwtCheck, deleteTrigger);

api.use(function errorHandler(err, req, res, next) {
    if (res.headersSent) {
        return next(err)
    }
    res.status(err.status || 500).send({
        "errors": [{
            "message": err.message
        }]
    });
});

function status(req, res) {
    stats();
    res.send('{ "status": "OK" }');
}

function testSetup(req, res) {
    res.sendFile(__dirname + '/testSetup.json')
}

function userInfo(req, res) {
    const userinfo = {
        "data": {
            "id": getUserId(req),
            "name": getUserEmail(req)
        }
    };
    res.send(userinfo);
}

function deleteTrigger(req, res) {
    const timeout = timeoutByTriggerId[req.body.trigger_identity];
    if (timeout) {
        console.log('Deleting trigger timeout', timeout)
        delete timeoutByTriggerId[req.body.trigger_identity];
        clearTimeout(timeout);
    }
    res.send();
}

function stats() {
    console.log('stats: ', {
        timeoutCount: Object.keys(timeoutByTriggerId).length,
        cacheStats: cacheStats()
    });
}

function getTriggerName(req) {
    return req.path.substring(req.path.lastIndexOf('/') + 1);
}

function getUserId(req) {
    return req.auth.payload.sub;
}

function getUserEmail(req) {
    return req.auth.payload['https://ifttt.com/semsportal/email'];
}

function getSvcToken(req) {
    return req.auth.payload['https://ifttt.com/semsportal/svc_access_token'];
}

async function metricTriggerAndTimer(req, res) {
    svcAccessTokenByUserId[getUserId(req)] = getSvcToken(req);
    const triggerName = getTriggerName(req);

    await metricTrigger(req, res, triggerName);

    if (!timeoutByTriggerId[req.body.trigger_identity]) {
        console.log(`${triggerName}: periodic check not yet scheduled`)
        // scheduleNextMetricCheck(req.body.trigger_identity, triggerName, req.body.triggerFields, null, getUserId(req));
        // TODOOOOO
        scheduleNextMetricCheck(req.body.trigger_identity, "metric_drops_below_limit", req.body.triggerFields, null, getUserId(req));
        scheduleNextMetricCheck(req.body.trigger_identity, "metric_exceeds_limit", req.body.triggerFields, null, getUserId(req));
    }
}

function scheduleNextMetricCheck(triggerIdentity, triggerName, triggerFields, metricCurrentValue, userId) {
    const delaySec = 60;
    console.log(`${triggerName}: scheduling next check in ${delaySec}s`);
    timeoutByTriggerId[triggerIdentity] = setTimeout(metricPeriodicCheck, delaySec * 1000, triggerIdentity, triggerName, triggerFields, metricCurrentValue, userId);
    stats();
}

async function metricPeriodicCheck(triggerIdentity, triggerName, triggerFields, metricLastCheckValue, userId) {
    console.log(`${triggerName}: periodic check`);
    let notify;
    let metricCurrentValue = metricLastCheckValue;

    try {
        const svcAccessToken = svcAccessTokenByUserId[userId];
        const limitValue = Number(triggerFields.limit_value);

        const semsRespBody = await getStationHistoryDataChart(triggerFields, svcAccessToken);
        const semsData = semsRespBody.data.list?.[0].inverters?.[0].targets?.[0].datas;
        metricCurrentValue = (semsData && semsData.length > 0) ? Number(semsData.at(-1).value) : null;

        notify = isMetricLimitCrossed(triggerName, metricCurrentValue, metricLastCheckValue, limitValue);
    } catch (e) {
        if (e.status == 401) {
            console.log(`${triggerName}: notifying in order to refresh access token`);
            notify = true;
        } else {
            throw e;
        }
    } finally {
        scheduleNextMetricCheck(triggerIdentity, triggerName, triggerFields, metricCurrentValue, userId);
    }

    if (notify) {
        notifyIFTTT(triggerIdentity);
    }
}