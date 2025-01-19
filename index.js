import express from "express-promise-router";
import { auth } from 'express-oauth2-jwt-bearer';
import { trigger, triggerOptions, getStationHistoryCurrentData, isMetricLimitCrossed } from './semsportal.js';
import { notifyIFTTT } from './ifttt-realtime.js';

const jobs = {}; // inverterId -> timeout
const triggerData = {}; // triggerId -> trigger data object
const triggerIds = {}; // inverterId -> set of triggerIds
const svcAccessTokens = {}; // userId -> upstream service access token

const JOB_FIXED_DELAY_MS = 60 * 1000;
const JOB_ONE_TIME_OFFSET_MS = 5 * 1000;
const JOB_ADVANCE_FN_COEFF = 1;
const JOB_MAX_ADVANCE_MS = JOB_ONE_TIME_OFFSET_MS * 0.95;
const JOB_STARTUP_CALLS_NUM = Math.ceil(Math.sqrt(JOB_MAX_ADVANCE_MS / JOB_ADVANCE_FN_COEFF));
const JOB_SLEEP_DELAY_MS = 5 * 60 * 1000;

export const api = express();

process.on('exit', function () {
    const timeouts = Object.values(jobs);
    console.log(`${timeouts.length} jobs have been unregistered before exiting`);
    timeouts.forEach((timeout) => {
        clearTimeout(timeout);
    });
});

function serviceKeyCheck(req, res, next) {
    if (process.env.IFTTT_SERVICE_KEY !== req.get("IFTTT-Service-Key")) {
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
    if (req.body.triggerFields && req.body.triggerFields.inverter_metric_id && req.body.triggerFields.limit_value) {
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
            scheduleInverterJob(userId, inverterId, null, null, JOB_STARTUP_CALLS_NUM, Date.now());
            console.log(`${inverterId}: job has been registered`);
        }
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
    res.sendFile('testSetup.json', { root: '.' })
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
        triggers: Object.keys(triggerData).length
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

function scheduleInverterJob(userId, inverterId, currentCheckTime, lastCheckTime, jobCallsNumSinceHit, lastJobStartTime) {
    console.log('currentCheckTime, lastCheckTime:', currentCheckTime, lastCheckTime);
    let jobAdvanceMs = 0;
    let jobTookMs = null;
    let jobDelayMs = null;

    if (isInverterUploadTimeHit(currentCheckTime, lastCheckTime)) {
        if (jobCallsNumSinceHit == 1) {
            console.log(`${inverterId}: inverter is probably shut down`);
            jobCallsNumSinceHit = 0;
            jobTookMs = Date.now() - lastJobStartTime;
            jobDelayMs = JOB_SLEEP_DELAY_MS;
        } else {
            console.log(`${inverterId}: inverter upload time hit after ${jobCallsNumSinceHit} calls`);
            jobCallsNumSinceHit = 0;
            jobTookMs = Date.now() - lastJobStartTime;
            jobDelayMs = JOB_FIXED_DELAY_MS - jobTookMs + JOB_ONE_TIME_OFFSET_MS;
        }
    } else {
        jobAdvanceMs = countJobAdvance(jobCallsNumSinceHit);
        jobTookMs = Date.now() - lastJobStartTime;
        jobDelayMs = JOB_FIXED_DELAY_MS - jobTookMs - jobAdvanceMs;
    }
    // do no put any code here in order to keep jobDelayMs as precise as possible

    jobs[inverterId] = setTimeout(inverterJob, jobDelayMs, userId, inverterId, currentCheckTime, jobCallsNumSinceHit + 1);
    console.log(`${inverterId}: job took ${Math.round(jobTookMs / 10) / 100}s, planned advance ${jobAdvanceMs}s (after ${jobCallsNumSinceHit} calls since hit), next job scheduled in ${Math.round(jobDelayMs / 10) / 100}s`);
}

function isInverterUploadTimeHit(currentCheckTime, lastCheckTime) {
    // the time values are:
    // - undefined if no data is being returned since midnight until the morning
    // - some useful time during the daylight
    // - the last value measured when the inverter shuts down until the midnight
    // - null when the sems service call timeouts ->ignore
    return currentCheckTime === lastCheckTime && currentCheckTime != null && lastCheckTime != null;
}

function countJobAdvance(callsNumSinceHit) {
    return Math.min(callsNumSinceHit * callsNumSinceHit * JOB_ADVANCE_FN_COEFF, JOB_MAX_ADVANCE_MS);
}

async function inverterJob(userId, inverterId, lastCheckTime, callsNumSinceHit) {
    const jobStartTime = Date.now();
    console.log(`${inverterId}: job started`);
    const tIds = Array.from(triggerIds[inverterId]);
    let triggerIdsToNotify = null;
    let currentCheckTime = null;

    try {
        const metricIds = tIds.map((tId) => triggerData[tId].triggerFields.inverter_metric_id.split('&')[1]);
        const uniqueMetricIds = [...new Set(metricIds)];
        const targets = await getStationHistoryCurrentData(inverterId, uniqueMetricIds, lastCheckTime, svcAccessTokens[userId]);

        if (targets) {
            targets.forEach((t) => {
                const currentData = t.datas?.at(-1);
                console.log(`current ${t.target_name} data: ${currentData ? JSON.stringify(currentData) : 'unavailable'}`);
            });

            triggerIdsToNotify = tIds.filter((tId) => {
                const tData = triggerData[tId];
                const targetKey = tData.triggerFields.inverter_metric_id.split('&')[1].split('|')[1];
                const target = targets.find((t) => targetKey === t.target_key);

                const currentData = target?.datas?.at(-1);
                const ret = isMetricLimitCrossed(tData.triggerName, currentData?.value, tData.metricLastValue, tData.triggerFields.limit_value);
                console.log('isMetricLimitCrossed:', tData.triggerName, currentData?.value, tData.metricLastValue, tData.triggerFields.limit_value, ret);

                if (currentData?.value == tData.triggerFields.limit_value) {
                    // when the metric lands on the limit but bounces back above, this prevents triggering metric_exceeded without previously triggering metric_dropped_below (and vice versa)
                    console.log('metric is right on the limit, withholding the notification and waiting for the next data to decide');
                } else {
                    tData.metricLastValue = currentData?.value;
                    currentCheckTime = currentData?.stat_date;
                }
                return ret;
            });
        }
    } catch (e) {
        if (e.status == 401) {
            console.log(`${inverterId}: notifying in order to refresh access token`);
            triggerIdsToNotify = tIds.slice(0, 1);
        } else {
            throw e;
        }
    } finally {
        scheduleInverterJob(userId, inverterId, currentCheckTime, lastCheckTime, callsNumSinceHit, jobStartTime);
    }

    console.log('triggerIdsToNotify:', triggerIdsToNotify);
    notifyIFTTT(triggerIdsToNotify);
}