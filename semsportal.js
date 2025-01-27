import { logDebug, getUserFromToken, callHttpJson, throwError } from './helper.js';
import getUuid from 'uuid-by-string';
import { find } from 'geo-tz';

const SEMS_PORTAL_API_BASEURL = 'https://eu.semsportal.com/api/';

async function trigger(req, res) {
    if (req.body.triggerFields && req.body.triggerFields.inverter_metric_id && req.body.triggerFields.limit_value) {
        let triggerDataLimit = req.body.limit;
        if (typeof triggerDataLimit === "undefined") {
            triggerDataLimit = 50;
        }

        const triggerData = [];
        const [inverterId, metricId] = req.body.triggerFields.inverter_metric_id.split('&');
        const tzOffset = inverterId.split('|')[1];
        const nowLocalTzString = tzDateToISOString(Date.now(), tzOffset);
        const startTime = nowLocalTzString.slice(0, 10) + ' 00:00';
        const endTime = nowLocalTzString.slice(0, 10) + ' 23:59';

        const semsRespBody = await getStationHistoryDataChart(inverterId, [metricId], getUserFromToken(req).auth.access_token, startTime, endTime);

        const semsData = semsRespBody.data.list?.[0].inverters?.[0].targets?.[0].datas;
        if (semsData && semsData.length > 0) {
            const triggerName = getTriggerName(req);
            if (isMetricLimitSatisfied(triggerName, semsData.at(-1).value, req.body.triggerFields.limit_value)) {
                // always return fresh triggerData only
                // when the metric is volatile, this avoids getting stuck in the wrong state in case one trigger type overtakes the other
                // v1^3v2 or ^1v3^2 - when no.3 is being processed after no.2, better do not return triggerData at all

                for (let i = semsData.length - 1; i > 0 && triggerData.length < triggerDataLimit; i--) {
                    if (isMetricLimitCrossed(triggerName, semsData[i].value, semsData[i - 1].value, req.body.triggerFields.limit_value)) {
                        triggerData.push(createIFTTTTriggerData(semsRespBody, semsData[i], req.body.triggerFields.limit_value, tzOffset));
                    }
                }
            }
        }

        if (req.get('IFTTT-Test-Mode') === '1') {
            // when being tested, top the data with fakes up to 3 items
            for (let i = 0; triggerData.length < triggerDataLimit && triggerData.length < 3; i++) {
                const semsData = { stat_date: '12/24/2024 20:00', value: -1 * i };
                triggerData.push(createIFTTTTriggerData(semsRespBody, semsData, req.body.triggerFields.limit_value, tzOffset));
            }
        }

        res.status(200).send({
            data: triggerData
        });
    } else {
        respondBadRequest(res, "Some trigger fields missing");
    }
}

function isMetricLimitSatisfied(triggerName, metricCurrentValue, limitValue) {
    return isMetricLimitCrossed(triggerName, metricCurrentValue, limitValue, limitValue);
}

function isMetricLimitCrossed(triggerName, metricCurrentValue, metricPreviousValue, limitValue) {
    const metricCurrentValueNum = Number(metricCurrentValue),
        metricPreviousValueNum = Number(metricPreviousValue),
        limitValueNum = Number(limitValue);
    return ((triggerName === 'metric_exceeds_limit' && metricCurrentValueNum != null && metricCurrentValueNum > limitValueNum && metricPreviousValueNum != null && metricPreviousValueNum <= limitValueNum)
        || (triggerName === 'metric_drops_below_limit' && metricCurrentValueNum != null && metricCurrentValueNum < limitValueNum && metricPreviousValueNum != null && metricPreviousValueNum >= limitValueNum));
}

async function getStationHistoryCurrentData(inverterId, metricIds, lastCheckTime, svcAccessToken) {
    const tzOffset = inverterId.split('|')[1];
    const nowLocalTzString = tzDateToISOString(Date.now(), tzOffset);
    const startTime = (lastCheckTime) ? new Date(lastCheckTime).toISOString().slice(0, 16) : nowLocalTzString.slice(0, 10) + ' 00:00';
    const endTime = nowLocalTzString.slice(0, 10) + ' 23:59';
    logDebug('semsportal startTime:', startTime);

    const semsRespBody = await getStationHistoryDataChart(inverterId, metricIds, svcAccessToken, startTime, endTime);
    return semsRespBody?.data?.list?.[0].inverters?.[0].targets;
}

async function getStationHistoryDataChart(inverterId, metricIds, svcAccessToken, startTime, endTime) {
    const semsRespBody = await callHttpJson('POST', SEMS_PORTAL_API_BASEURL + 'v0/HistoryData/GetStationHistoryDataChart', { Token: svcAccessToken },
        createGetStationHistoryDataChartPayload(inverterId, metricIds, startTime, endTime));
    checkResponseCode(semsRespBody);
    return semsRespBody;
}

async function triggerOptions(req, res) {
    const inverterOptionsData = [];

    const semsRespBody = await callHttpJson('POST', SEMS_PORTAL_API_BASEURL + 'v0/PowerStationMonitor/QueryPowerStationMonitor', { Token: getUserFromToken(req).auth.access_token }, createQueryPowerStationMonitorPayload());
    checkResponseCode(semsRespBody);

    if (semsRespBody.data.list) {
        for (const ps of semsRespBody.data.list) {
            const semsRespBody2 = await callHttpJson('POST', SEMS_PORTAL_API_BASEURL + 'v2/PowerStation/GetMonitorDetailByPowerstationId', { Token: getUserFromToken(req).auth.access_token }, createGetMonitorDetailByPowerstationIdPayload(ps.powerstation_id));
            checkResponseCode(semsRespBody);

            const powerStationTz = find(ps.latitude, ps.longitude);
            const powerStationTzOffset = getOffsetFromTz(powerStationTz);

            semsRespBody2.data.inverter?.forEach((i) => {
                const metricOptionsData = [];
                i.points?.forEach((t) => {
                    metricOptionsData.push(createMetricIFTTTOptionsData(ps.powerstation_id, powerStationTzOffset, i.sn, t.target_index, t.target_key, t.display));
                });
                inverterOptionsData.push(createInverterIFTTTOptionsData(ps.stationname, i.name, metricOptionsData));
            });
        }
    }

    res.status(200).send({
        data: inverterOptionsData
    });
}

function createIFTTTTriggerData(semsRespBody, semsData, limitValue, tzOffset) {
    return {
        created_at: new Date(semsData.stat_date + tzOffset).toISOString(), // must be ISO8601 in UTC
        inverter: semsRespBody.data.list[0].inverters[0].name + " - " + semsRespBody.data.list[0].pw_name,
        metric: semsRespBody.data.list[0].inverters[0].targets[0].target_name,
        unit: semsRespBody.data.list[0].inverters[0].targets[0].target_unit,
        limit_value: limitValue,
        current_value: Math.floor(semsData.value) == semsData.value ? Math.floor(semsData.value) : semsData.value,
        meta: {
            id: getUuid(JSON.stringify(semsData)), // a unique identifier used to prevent Applets from firing more than once on the same item
            timestamp: Date.parse(semsData.stat_date + tzOffset) / 1000 // metas must be in descending order by the timestamp (in Unix seconds)
        }
    };
}

function createGetStationHistoryDataChartPayload(inverterId, metricIds, startTime, endTime) {
    const targets = metricIds.map((mId) => {
        const [targetIndex, targetKey] = mId.split('|');
        return {
            target_key: targetKey,
            target_index: Number(targetIndex)
        }
    });

    const [powerStationId, powerStationTzOffset, inverterSn] = inverterId.split('|');
    return {
        qry_time_start: startTime,
        qry_time_end: endTime,
        times: Math.floor(Math.random() * 65535), // makes the request body unique and forces no caching (header Cache-Control: no-cache is ignored)
        pws_historys: [{
            id: powerStationId,
            inverters: [{
                sn: inverterSn
            }]
        }],
        targets: targets
    };
}

function createQueryPowerStationMonitorPayload() {
    return {
        page_index: 1,
        page_size: 50
    };
}

function createGetMonitorDetailByPowerstationIdPayload(powerStationId) {
    return {
        powerStationId: powerStationId
    };
}

function createInverterIFTTTOptionsData(powerStationName, inverterName, metricOptionsData) {
    return {
        label: inverterName + " - " + powerStationName,
        values: metricOptionsData
    };
}

function createMetricIFTTTOptionsData(powerStationId, powerStationTzOffset, inverterSn, targetIndex, targetKey, targetName) {
    return {
        label: targetIndex + "  " + targetName,
        value: powerStationId + "|" + powerStationTzOffset + "|" + inverterSn + "&" + targetIndex + "|" + targetKey
    };
}

function getTriggerName(req) {
    return req.path.substring(req.path.lastIndexOf('/') + 1);
}

function getOffsetFromTz(timeZone = 'UTC', date = new Date()) {
    const utcDate = new Date(date.toLocaleString('en-US', { timeZone: 'UTC' }));
    const tzDate = new Date(date.toLocaleString('en-US', { timeZone }));
    const offsetMinutes = (tzDate.getTime() - utcDate.getTime()) / 6e4;
    return (offsetMinutes < 0 ? '-' : '+') + String(Math.abs(offsetMinutes) / 60).padStart(2, '0') + String(offsetMinutes % 60).padStart(2, '0');
}

function tzDateToISOString(timestamp, tzOffset = "+0000") {
    const [offsetHours, offsetMinutes] = tzOffset.match(/.{1,3}/g);
    const tzOffsetMinutes = (Number(offsetHours) * 60 + Number(offsetMinutes)) * 6e4;
    return new Date(timestamp + tzOffsetMinutes).toISOString().slice(0, -1) + tzOffset;
}

function checkResponseCode(semsRespBody) {
    switch (semsRespBody?.code) {
        case 0: // success
            break;
        case 100000:
            throwError(401, 'Provider: System error');
        case 100001:
            throwError(401, 'Provider: Unknown authentication error');
        case 100002:
            throwError(401, 'Provider: Access token has expired');
        default:
            throwError(502, 'Provider: Unknown error');
    }
}

function respondBadRequest(res, msg) {
    res.status(400).send({
        errors: [{
            message: msg
        }]
    });
}

export default { trigger, triggerOptions, getStationHistoryCurrentData, isMetricLimitCrossed };
