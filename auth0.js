import { auth } from 'express-oauth2-jwt-bearer';
import { callHttpJson } from './helper.js';

const BASE_URL = 'https://dev-4wnwsvy10pt0430e.us.auth0.com/';

const jwtCheck = auth({
    audience: 'semsportal-ifttt',
    issuerBaseURL: BASE_URL,
    tokenSigningAlg: 'RS256'
});

async function getAuth0AccessToken() {
    return await callHttpJson('POST', BASE_URL + 'oauth/token', null,
        { "client_id": process.env.AUTH0_API_CLIENT_ID, "client_secret": process.env.AUTH0_API_CLIENT_SECRET, "audience": "https://dev-4wnwsvy10pt0430e.us.auth0.com/api/v2/", "grant_type": "client_credentials" });
}

async function getUsersWithPlan() {
    const res = await getAuth0AccessToken();
    return callHttpJson('GET', BASE_URL + 'api/v2/users?fields=user_id%2Capp_metadata.plan&include_fields=true&q=_exists_%3Aapp_metadata.plan.created_at', { Authorization: res.token_type + ' ' + res.access_token });
}

export default { jwtCheck: jwtCheck, getUsersWithPlan: getUsersWithPlan };