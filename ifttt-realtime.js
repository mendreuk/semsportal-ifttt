import { callHttpJson } from './helper.js';
import getUuid from 'uuid-by-string';

async function notify(userIds, triggerIds) {
    if (!userIds) userIds = [];
    if (!triggerIds) triggerIds = [];
    
    if (userIds.length || triggerIds.length) {
        await callHttpJson('POST', 'https://realtime.ifttt.com/v1/notifications', { 'IFTTT-Service-Key': process.env.IFTTT_SERVICE_KEY, 'X-Request-ID': getUuid(JSON.stringify([...userIds, ...triggerIds])) },
            createRealtimeNotificationPayload(userIds, triggerIds));
    }
}

function createRealtimeNotificationPayload(userIds, triggerIds) {
    return {
        "data": userIds.map((userId) => { return { "user_id": userId } }).concat(triggerIds.map((triggerId) => { return { "trigger_identity": triggerId } }))
    }
}

export default { notify: notify };