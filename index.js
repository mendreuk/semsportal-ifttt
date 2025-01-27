import express from "express-promise-router";
import { setLogTrace, addLogComponents, logInfo, logDebug, logError, getUserFromToken } from './helper.js';
import semsportal from './semsportal.js';
import auth0 from './auth0.js';
import ifttt from './ifttt-realtime.js';

const JOB_FIXED_DELAY_MS = 60 * 1000; // TODO nekdo bude treba s 5-minutovym planem
const JOB_ONE_TIME_OFFSET_MS = 5 * 1000;
const JOB_ADVANCE_FN_COEFF = 1;
const JOB_MAX_ADVANCE_MS = JOB_ONE_TIME_OFFSET_MS * 0.95;
const JOB_STARTUP_CALLS_NUM = 999999;
const JOB_SLEEP_DELAY_MS = 5 * 60 * 1000;

const jobs = {}; // inverterId -> timeout
const triggerData = {}; // triggerId -> trigger data object
const triggerIds = {}; // inverterId -> set of triggerIds
const providerAccessTokens = {}; // userId -> provider access token

export const api = express();

process.on('exit', function () {
    const timeouts = Object.values(jobs);
    logInfo(`${timeouts.length} jobs have been unregistered before exiting`);
    timeouts.forEach((timeout) => {
        clearTimeout(timeout);
    });
});

api.use(function setLogTraceFromReq(req, res, next) {
    if (typeof req !== 'undefined') {
        const traceHeader = req.header('X-Cloud-Trace-Context');
        if (traceHeader) {
            setLogTrace(traceHeader.split('/')[0]);

            const [inverterId, metricId] = req.body.triggerFields.inverter_metric_id.split('&');
            addLogComponents({
                inverterId: inverterId,
                metricId: metricId,
                triggerName: getTriggerName(req),
                triggerId: req.body.trigger_identity
            });
        }
    }
    next();
});

api.use(function requestLogger(req, res, next) {
    logInfo('<req ' + req.method + ' IFTTT ' + req.path + '<:', req.headers, req.body);
    next();
});

api.use(function responseLogger(req, res, next) {
    let send = res.send;
    res.send = (content) => {
        logInfo('>res ' + res.statusCode + ' IFTTT ' + req.path + '>:', content ? JSON.stringify(content) : '');
        res.send = send;
        return res.send(content);
    }
    next();
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

function providerAccessTokenCheck(req, res, next) {
    const userId = getUserId(req);
    addLogComponents({ userId: userId });

    const providerAccessToken = getUserFromToken(req)?.auth?.access_token;
    if (!providerAccessToken) {
        const err = Error('Missing provider access token');
        err.status = 401;
        next(err);
    } else {
        next();
    }
}

function registerTrigger(req, res, next) {
    const user = getUserFromToken(req);
    logDebug('subscriptionPlan:', user.subscription);
    if (checkSubscriptionPlan(user.subscription) && req.body.triggerFields && req.body.triggerFields.inverter_metric_id && req.body.triggerFields.limit_value) {
        const userId = getUserId(req);
        providerAccessTokens[userId] = getUserFromToken(req).auth.access_token;

        const [inverterId, metricId] = req.body.triggerFields.inverter_metric_id.split('&');
        const triggerId = req.body.trigger_identity;
        if (!triggerData[triggerId]) {
            triggerData[triggerId] = {
                userId: userId,
                triggerName: getTriggerName(req),
                triggerFields: req.body.triggerFields,
                metricLastValue: null
            }
            logInfo('trigger has been registered');
        }

        if (!triggerIds[inverterId]) {
            triggerIds[inverterId] = new Set();
        }
        triggerIds[inverterId].add(triggerId);

        if (!jobs[inverterId]) {
            scheduleInverterJob(userId, inverterId, null, null, JOB_STARTUP_CALLS_NUM, Date.now());
            logInfo('job has been registered');
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
            logInfo('job has been unregistered');
        }
    }

    delete triggerData[triggerId];
    logInfo('trigger has been unregistered');

    stats();
}

api.get('/ifttt/v1/status', serviceKeyCheck, status);
api.post('/ifttt/v1/test/setup', serviceKeyCheck, testSetup);
api.get('/ifttt/v1/user/info', auth0.jwtCheck, userInfo);

api.post('/ifttt/v1/triggers/metric_drops_below_limit', auth0.jwtCheck, providerAccessTokenCheck, registerTrigger, semsportal.trigger);
api.post('/ifttt/v1/triggers/metric_drops_below_limit/fields/inverter_metric_id/options', auth0.jwtCheck, providerAccessTokenCheck, semsportal.triggerOptions);
api.delete('/ifttt/v1/triggers/metric_drops_below_limit/trigger_identity/:triggerId', auth0.jwtCheck, deleteTrigger);

api.post('/ifttt/v1/triggers/metric_exceeds_limit', auth0.jwtCheck, providerAccessTokenCheck, registerTrigger, semsportal.trigger);
api.post('/ifttt/v1/triggers/metric_exceeds_limit/fields/inverter_metric_id/options', auth0.jwtCheck, providerAccessTokenCheck, semsportal.triggerOptions);
api.delete('/ifttt/v1/triggers/metric_exceeds_limit/trigger_identity/:triggerId', auth0.jwtCheck, deleteTrigger);

api.use(function errorHandler(err, req, res, next) {
    if (res.headersSent) {
        return next(err)
    }
    logError(err.stack);
    res.status(err.status || 500).send({
        "errors": [{
            "message": err.message
        }]
    });
});

startSubscribedUsersTriggers();

async function startSubscribedUsersTriggers() {
    const subscribedUsers = await auth0.getSubscribedUsers();
    const subscribedUsersToStartJobs = subscribedUsers
        .filter((user) => checkSubscriptionPlan(user.app_metadata?.subscription))
        .map((user) => user.user_id);

    logDebug('subscribedUsersToStartJobs:', subscribedUsersToStartJobs);
    ifttt.notify(subscribedUsersToStartJobs);
}

function checkSubscriptionPlan(subscription) {
    return subscription !== null
        && subscription.expires_at > Date.now()
        && subscription.plan === 'check_every_minute';
}

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
        users: Object.keys(providerAccessTokens).length,
        jobs: Object.keys(jobs).length,
        triggers: Object.keys(triggerData).length
    };
    logInfo('stats: ', stats);
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
    return getUserFromToken(req).email;
}

function scheduleInverterJob(userId, inverterId, currentCheckTime, lastCheckTime, jobCallsNumSinceHit, lastJobStartTime) {
    logDebug(`currentCheckTime: ${currentCheckTime}, lastCheckTime: ${lastCheckTime}`);

    // the time values are:
    // - undefined if no data is being returned since midnight until the morning
    // - some useful time during the daylight
    // - the last value measured when the inverter shuts down until the midnight
    // - null after startup or when the semsportal call timeouts (usually takes longer to recover)
    let jobBaseDelayMs = JOB_FIXED_DELAY_MS;
    if (currentCheckTime === lastCheckTime) {
        if (jobCallsNumSinceHit == 1) {
            logInfo('inverter is probably shut down or semsportal is temporarily unavailable');
            jobBaseDelayMs = JOB_SLEEP_DELAY_MS;
            jobCallsNumSinceHit = 0;
        } else if (jobCallsNumSinceHit != JOB_STARTUP_CALLS_NUM) {
            logInfo(`inverter upload time hit after ${jobCallsNumSinceHit} calls`);
            jobBaseDelayMs += JOB_ONE_TIME_OFFSET_MS;
            jobCallsNumSinceHit = 0;
        }
    }

    const jobAdvanceMs = countJobAdvance(jobCallsNumSinceHit);
    const jobTookMs = Date.now() - lastJobStartTime;
    const jobDelayMs = jobBaseDelayMs - jobTookMs - jobAdvanceMs;
    // do no put any code here in order to keep jobDelayMs as precise as possible

    jobs[inverterId] = setTimeout(inverterJob, jobDelayMs, userId, inverterId, currentCheckTime, jobCallsNumSinceHit + 1);
    logInfo(`job took ${Math.round(jobTookMs / 10) / 100}s, planned advance ${jobAdvanceMs / 1000}s (after ${jobCallsNumSinceHit} calls since hit), next job scheduled in ${Math.round(jobDelayMs / 10) / 100}s`);
}

function countJobAdvance(callsNumSinceHit) {
    return Math.min(callsNumSinceHit * callsNumSinceHit * JOB_ADVANCE_FN_COEFF, JOB_MAX_ADVANCE_MS);
}

async function inverterJob(userId, inverterId, lastCheckTime, callsNumSinceHit) {
    const jobStartTime = Date.now();
    setLogTrace(jobs[inverterId]);
    addLogComponents({
        userId: userId,
        inverterId: inverterId
    });
    logInfo('job started');

    const tIds = Array.from(triggerIds[inverterId]);
    let triggerIdsToNotify = [];
    let currentCheckTime = null;

    try {
        const metricIds = tIds.map((tId) => triggerData[tId].triggerFields.inverter_metric_id.split('&')[1]);
        const uniqueMetricIds = [...new Set(metricIds)];
        const targets = await semsportal.getStationHistoryCurrentData(inverterId, uniqueMetricIds, lastCheckTime, providerAccessTokens[userId]);

        if (targets) {
            targets.forEach((t) => {
                const currentData = t.datas?.at(-1);
                logDebug(`current ${t.target_name} data: ${currentData ? JSON.stringify(currentData) : 'unavailable'}`);
            });

            triggerIdsToNotify = tIds.filter((tId) => {
                const tData = triggerData[tId];
                const targetKey = tData.triggerFields.inverter_metric_id.split('&')[1].split('|')[1];
                const target = targets.find((t) => targetKey === t.target_key);

                const currentData = target?.datas?.at(-1);
                const ret = semsportal.isMetricLimitCrossed(tData.triggerName, currentData?.value, tData.metricLastValue, tData.triggerFields.limit_value);
                logDebug('isMetricLimitCrossed:', tData.triggerName, currentData?.value, tData.metricLastValue, tData.triggerFields.limit_value, ret);

                if (currentData?.value == tData.triggerFields.limit_value) {
                    // when the metric lands on the limit but bounces back above, this prevents triggering metric_exceeded without previously triggering metric_dropped_below (and vice versa)
                    logDebug('metric is right on the limit, withholding the notification and waiting for the next data to decide');
                } else {
                    tData.metricLastValue = currentData?.value;
                    currentCheckTime = currentData?.stat_date;
                }
                return ret;
            });
        }
    } catch (err) {
        if (err.status == 401) {
            logInfo('notifying in order to refresh access token');
            triggerIdsToNotify = tIds.slice(0, 1);
        } else {
            logEror(err.stack);
        }
    } finally {
        scheduleInverterJob(userId, inverterId, currentCheckTime, lastCheckTime, callsNumSinceHit, jobStartTime);
    }

    logDebug('triggerIdsToNotify:', triggerIdsToNotify);
    ifttt.notify(null, triggerIdsToNotify);
}