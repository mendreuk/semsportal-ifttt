import https from 'https';

const PROJECT = "semsportalifttt";
const globalLogFields = {};
let globalLogComponents;

export function setLogTrace(trace) {
    globalLogFields['logging.googleapis.com/trace'] = `projects/${PROJECT}/traces/${trace}`;
    globalLogComponents = {};
}

export function addLogComponents(components) {
    Object.assign(globalLogComponents, components);
}

export function logError() {
    log([...arguments], 'ERROR');
}

export function logWarning() {
    log([...arguments], 'WARNING');
}

export function logInfo() {
    log([...arguments], 'INFO');
}

export function logDebug() {
    log([...arguments], 'DEBUG');
}

function log(msgs, severity = 'DEFAULT') {
    const entry = Object.assign({
        severity: severity,
        message: msgs.map((o) => (typeof o == 'string') ? o : JSON.stringify(o)).join(' '),
    },
        globalLogComponents,
        globalLogFields
    );
    console.log(JSON.stringify(entry));
}

export function getUserFromToken(req) {
    return req.auth.payload['https://ifttt.com/semsportal/user'];
}

export function getTriggerName(req) {
    return req.path.substring(req.path.lastIndexOf('/') + 1);
}

export async function callHttpJson(method, url, headers, payload) {
    const options = {
        headers: {
            'Connection': 'close'
        },
        method: method,
        timeout: 3000
    };
    options.headers = {
        ...options.headers,
        ...headers,
    };
    if (payload) {
        payload = JSON.stringify(payload);
        options.headers = {
            ...options.headers,
            ...{ 'Content-Length': Buffer.byteLength(payload) },
            ...{ 'Content-Type': 'application/json' }
        };
    }

    let response;
    await new Promise((resolve, reject) => {
        const req = https.request(url, options, (res) => {
            res.setEncoding('utf8');
            let body = '';
            res.on('data', (chunk) => { body += chunk });
            res.on('end', () => { resolve({ 'status': res.statusCode, 'body': body }) });
        });
        req.on('error', (e) => { e.code ? reject(e.code.replace(/\n|\r/g, "")) : e.code }); // avoid log injection
        req.on('timeout', () => reject("timeout")); // covers both connection and read timeouts
        if (payload) {
            req.write(payload);
        }
        logInfo('>req ' + method + ' ' + url + '>:', JSON.stringify(options.headers), payload ? payload : '');
        req.end();
    }).then(
        async (res) => {
            logInfo('<res ' + res.status + ' ' + url + '<:', res.body);
            if (res.status >= 200 && res.status < 300) {
                try {
                    response = JSON.parse(res.body);
                } catch (e) {
                    throwError(502, 'Invalid response body');
                }
            } else {
                throwError(502, 'Error status received');
            }
        },
        async (error) => {
            logInfo('>req error ' + url + '>:', error);
            throwError(502, 'Request error');
        });
    return response;
}

export function throwError(status, message) {
    const err = new Error(message);
    err.status = status;
    throw err;
}