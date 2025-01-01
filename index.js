const express = require("express-promise-router");
const { auth } = require('express-oauth2-jwt-bearer');
const semsportal = require('./semsportal');

const IFTTT_SERVICE_KEY = process.env.IFTTT_SERVICE_KEY;

const app = express();

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

app.use(function requestLogger(req, res, next) {
    console.log('<req ' + req.method + ' IFTTT ' + req.path + '<:', req.headers, req.body);
    next();
});

app.use(function responseLogger(req, res, next) {
    let send = res.send;
    res.send = (content) => {
        console.log('>res ' + res.statusCode + ' IFTTT ' + req.path + '>:', content ? JSON.stringify(content) : '');
        res.send = send;
        return res.send(content);
    }
    next();
});

app.get('/ifttt/v1/status', serviceKeyCheck, status);
app.post('/ifttt/v1/test/setup', serviceKeyCheck, testSetup);
app.get('/ifttt/v1/user/info', jwtCheck, userInfo);

app.post('/ifttt/v1/triggers/metric_drops_below_limit', jwtCheck, semsportal.metricTrigger);
app.post('/ifttt/v1/triggers/metric_drops_below_limit/fields/inverter_metric_id/options', jwtCheck, semsportal.inverterMetricTriggerOptions);
app.delete('/ifttt/v1/triggers/metric_drops_below_limit/trigger_identity/:triggerId', jwtCheck, deleteTrigger);

app.post('/ifttt/v1/triggers/metric_exceeds_limit', jwtCheck, semsportal.metricTrigger);
app.post('/ifttt/v1/triggers/metric_exceeds_limit/fields/inverter_metric_id/options', jwtCheck, semsportal.inverterMetricTriggerOptions);
app.delete('/ifttt/v1/triggers/metric_exceeds_limit/trigger_identity/:triggerId', jwtCheck, deleteTrigger);

app.use(function errorHandler(err, req, res, next) {
    if (res.headersSent) {
        return next(err)
    }
    res.status(err.status || 500).send({
        "errors": [{
            "message": err.message
        }]
    });
});

exports.api = app;

function status(req, res) {
    res.send('{ "status": "OK" }');
}

function testSetup(req, res) {
    res.sendFile(__dirname + '/testSetup.json')
}

function userInfo(req, res) {
    const userinfo = {
        "data": {
            "id": req.auth.payload.sub,
            "name": req.auth.payload['https://ifttt.com/semsportal/email']
        }
    };
    res.send(userinfo);
}

function deleteTrigger(req, res) {
    res.send();
}