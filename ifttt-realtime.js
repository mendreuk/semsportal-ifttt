import { callHttpJson } from './helper.js';
import getUuid from 'uuid-by-string';

const IFTTT_SERVICE_KEY = process.env.IFTTT_SERVICE_KEY;

export async function notifyIFTTT(triggerIdentity) {
    await callHttpJson('POST', 'https://realtime.ifttt.com/v1/notifications', { 'IFTTT-Service-Key': String(IFTTT_SERVICE_KEY), 'X-Request-ID': getUuid(triggerIdentity) },
        createRealtimeNotificationPayload(triggerIdentity));
}

function createRealtimeNotificationPayload(triggerIdentity) {
    return {
        "data": [
            {
                "trigger_identity": triggerIdentity
            }
        ]
    }
}