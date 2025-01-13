import { callHttpJson } from './helper.js';
import getUuid from 'uuid-by-string';

export async function notifyIFTTT(triggerIds) {
    if (triggerIds?.length) {
        await callHttpJson('POST', 'https://realtime.ifttt.com/v1/notifications', { 'IFTTT-Service-Key': process.env.IFTTT_SERVICE_KEY, 'X-Request-ID': getUuid(JSON.stringify(triggerIds)) },
            createRealtimeNotificationPayload(triggerIds));
    }
}

function createRealtimeNotificationPayload(triggerIds) {
    return {
        "data": triggerIds.map((triggerId) => { return { "trigger_identity": triggerId } })
    }
}