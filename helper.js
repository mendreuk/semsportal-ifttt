const https = require('https');

module.exports = {

    callHttpJson: async function (method, url, headers, payload) {
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
            console.log('>req ' + method + ' ' + url + '>:', JSON.stringify(options.headers), payload ? payload : '');
            req.end();
        }).then(
            async (res) => {
                console.log('<res ' + res.status + ' ' + url + '<:', res.body);
                if (res.status >= 200 && res.status < 300) {
                    try {
                        response = JSON.parse(res.body);
                    } catch (e) {
                        this.throwError(502, 'Invalid SVC response');
                    }
                } else {
                    module.exports.throwError(502, 'Error calling SVC');
                }
            },
            async (error) => {
                console.log('>req error ' + url + '>:', error);
                module.exports.throwError(502, 'Error calling SVC');
            });
        return response;
    },

    throwError: function (status, message) {
        const err = new Error(message);
        err.status = status;
        throw err;
    }

}