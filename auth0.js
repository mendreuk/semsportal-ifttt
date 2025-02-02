import { auth } from 'express-oauth2-jwt-bearer';
import { callHttpJson } from './helper.js';

const jwtCheck = auth({
    audience: 'semsportal-ifttt',
    issuerBaseURL: process.env.AUTH0_BASE_URL + '/',
    tokenSigningAlg: 'RS256'
});

async function getAuth0AccessToken() {
    return await callHttpJson('POST', process.env.AUTH0_BASE_URL + '/oauth/token', null,
        { "client_id": process.env.AUTH0_API_CLIENT_ID, "client_secret": process.env.AUTH0_API_CLIENT_SECRET, "audience": process.env.AUTH0_BASE_URL + "/api/v2/", "grant_type": "client_credentials" });
}

async function getUsersWithPlan() {
    const res = await getAuth0AccessToken();
    return callHttpJson('GET', process.env.AUTH0_BASE_URL + '/api/v2/users?fields=user_id%2Cuser_metadata.plan&include_fields=true&q=_exists_%3Auser_metadata.plan.created_at', { Authorization: res.token_type + ' ' + res.access_token });
}

export default { jwtCheck: jwtCheck, getUsersWithPlan: getUsersWithPlan };