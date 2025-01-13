import express from "express-promise-router";
import { auth } from 'express-oauth2-jwt-bearer';
import { trigger, triggerOptions, getStationHistoryCurrentData, isMetricLimitCrossed } from './semsportal.js';
import { notifyIFTTT } from './ifttt-realtime.js';

const IFTTT_SERVICE_KEY = process.env.IFTTT_SERVICE_KEY;

const jobs = {}; // inverterId -> timeout
const triggerData = {}; // triggerId -> trigger data object
const triggerIds = {}; // inverterId -> set of triggerIds
const svcAccessTokens = {}; // userId -> upstream service access token

export const api = express();

process.on('exit', function () {
    const timeouts = Object.values(jobs);
    console.log(`${timeouts.length} jobs have been unregistered before exiting`);
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

function registerTrigger(req, res, next) {
    const userId = getUserId(req);
    svcAccessTokens[userId] = getSvcToken(req);

    const [inverterId, metricId] = req.body.triggerFields.inverter_metric_id.split('&');

    const triggerId = req.body.trigger_identity;
    if (!triggerData[triggerId]) {
        triggerData[triggerId] = {
            userId: userId,
            triggerName: getTriggerName(req),
            triggerFields: req.body.triggerFields,
            metricLastValue: null
        }
        console.log(`${triggerId}: trigger has been registered`);
    }

    if (!triggerIds[inverterId]) {
        triggerIds[inverterId] = new Set();
    }
    triggerIds[inverterId].add(triggerId);

    if (!jobs[inverterId]) {
        scheduleInverterJob(inverterId, null, userId);
        console.log(`${inverterId}: job has been registered`);
    }

    stats();
    next();
}

function unregisterTrigger(req) {
    const triggerId = req.params['triggerId'];
    const inverterId = triggerData[triggerId].triggerFields.inverter_metric_id.split('&')[0];

    triggerIds[inverterId].delete(triggerId);

    if (triggerIds[inverterId].size == 0) {
        const timeout = jobs[inverterId];
        if (timeout) {
            delete jobs[inverterId];
            clearTimeout(timeout);
            console.log(`${inverterId}: job has been unregistered`);
        }
    }

    delete triggerData[triggerId];
    console.log(`${triggerId}: trigger has been unregistered`);

    stats();
}

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

api.post('/ifttt/v1/triggers/metric_drops_below_limit', jwtCheck, registerTrigger, trigger);
api.post('/ifttt/v1/triggers/metric_drops_below_limit/fields/inverter_metric_id/options', jwtCheck, triggerOptions);
api.delete('/ifttt/v1/triggers/metric_drops_below_limit/trigger_identity/:triggerId', jwtCheck, deleteTrigger);

api.post('/ifttt/v1/triggers/metric_exceeds_limit', jwtCheck, registerTrigger, trigger);
api.post('/ifttt/v1/triggers/metric_exceeds_limit/fields/inverter_metric_id/options', jwtCheck, triggerOptions);
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
    res.send({ "status": "OK", stats: stats() });
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
    unregisterTrigger(req);
    res.send();
}

function stats() {
    console.assert(equalSets(Object.keys(triggerIds), Object.keys(jobs)), "collections are inconsistent based on number of inverters %o", { triggerIds: Object.keys(triggerIds), inverterJobs: Object.keys(jobs) });
    const triggersFromTriggerId = Object.values(triggerIds).map((s) => Array.from(s)).flat();
    console.assert(equalSets(triggersFromTriggerId, Object.keys(triggerData)), "collections are inconsistent based on number of triggers %o", { triggerIds: triggersFromTriggerId, triggerData: Object.keys(triggerData) });

    const stats = {
        users: Object.keys(svcAccessTokens).length,
        jobs: Object.keys(jobs).length,
        triggers: Object.keys(triggerData).length,
        triggers_by_inverter: triggerIds
    };
    console.log('stats: ', stats);
    return stats;
}

function equalSets(xset, yset) {
    const xs = new Set(xset);
    const ys = new Set(yset);
    return xs.size === ys.size &&
        [...xs].every((x) => ys.has(x));
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

function scheduleInverterJob(inverterId, lastCheckTime, userId) {
    const delaySec = 60;
    console.log(`${inverterId}: scheduling job in ${delaySec}s`);
    jobs[inverterId] = setTimeout(inverterJob, delaySec * 1000, inverterId, lastCheckTime, userId);
}

async function inverterJob(inverterId, lastCheckTime, userId) {
    console.log(`${inverterId}: job started`);
    const tIds = Array.from(triggerIds[inverterId]);
    let triggerIdsToNotify = null;

    try {
        const metricIds = tIds.map((tId) => triggerData[tId].triggerFields.inverter_metric_id.split('&')[1]);
        const uniqueMetricIds = [...new Set(metricIds)];
        const targets = await getStationHistoryCurrentData(inverterId, uniqueMetricIds, lastCheckTime, svcAccessTokens[userId]);

        triggerIdsToNotify = tIds.filter((tId) => {
            const tData = triggerData[tId];
            const targetKey = tData.triggerFields.inverter_metric_id.split('&')[1].split('|')[1];
            const target = targets.find((t) => targetKey === t.target_key);
            const currentData = target?.datas?.at(-1);
            console.log(`current ${target?.target_name} data: ${currentData ? JSON.stringify(currentData) : 'unavailable'}`);
            const ret = isMetricLimitCrossed(tData.triggerName, currentData?.value, tData.metricLastValue, Number(tData.triggerFields.limit_value));
            console.log('isMetricLimitCrossed:', tData.triggerName, currentData?.value, tData.metricLastValue, Number(tData.triggerFields.limit_value), ret);
            tData.metricLastValue = currentData?.value;
            lastCheckTime = currentData?.stat_date;
            return ret;
        });
    } catch (e) {
        if (e.status == 401) {
            console.log(`${inverterId}: notifying in order to refresh access token`);
            triggerIdsToNotify = tIds.slice(0, 1);
        } else {
            throw e;
        }
    } finally {
        scheduleInverterJob(inverterId, lastCheckTime, userId);
    }

    console.log('triggerIdsToNotify:', triggerIdsToNotify);
    notifyIFTTT(triggerIdsToNotify);
}