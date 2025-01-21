// --- AUTH0 ACTIONS TEMPLATE https://github.com/auth0/opensource-marketplace/blob/main/templates/add-email-to-access-token-POST_LOGIN ---

const axios = require('axios');

const NAMESPACE = "https://ifttt.com/semsportal/";
/**
 * Handler that will be called during the execution of a PostLogin flow.
 *
 * @param {Event} event - Details about the user and the context in which they are logging in.
 * @param {PostLoginAPI} api - Interface whose methods can be used to change the behavior of the login.
 */
exports.onExecutePostLogin = async (event, api) => {
  const providerAccessToken = await refreshProviderAccessToken(event, api);
  const userClaim = getUserClaim(event, providerAccessToken);
  api.accessToken.setCustomClaim(NAMESPACE + 'user', userClaim);
};

/**
 * @param {Event} event - Details about the user and the context in which they are logging in.
* @param {string | null} providerAccessToken
*/
function getUserClaim(event, providerAccessToken) {
  const u = {};
  u.email = event.user.email;
  if (providerAccessToken) {
    u.auth = {};
    u.auth.access_token = providerAccessToken;
  }
  if (event.user.app_metadata.subscription?.plan) {
    u.subscription = {};
    u.subscription.created_at = event.user.app_metadata.subscription.created_at;
    u.subscription.expires_at = event.user.app_metadata.subscription.expires_at;
    u.subscription.plan = event.user.app_metadata.subscription.plan;
  }
  return u;
}

/**
* @param {Event} event - Details about the user and the context in which they are logging in.
* @param {PostLoginAPI} api
*/
async function refreshProviderAccessToken(event, api) {
  console.log('Refresh started');
  const auth = event.user.app_metadata.auth;
  const tokenOptions = {
    method: 'POST',
    url: `https://eu.semsportal.com/api/v2/Common/CrossLogin`,
    headers: { 'Token': '{"version":"v3.1","client":"ios","language":"en"}' },
    data: {
      account: event.user.email,
      pwd: Buffer.from(auth.password, 'base64').toString()
    }
  };
  let status = '';

  const res = await axios.request(tokenOptions)
    .catch(function (error) {
      if (error.response) {
        status = error.response.status;
      } else {
        status = error.message;
      }
    });

  let providerAccessToken = null;
  if (res && res.data && res.data.code == 0) {
    status = 'OK';
    providerAccessToken = Buffer.from(JSON.stringify(res.data.data)).toString('base64');
  } else if (res && res.data) {
    status = res.data.code + " " + res.data.msg;
  }
  console.log('Returned', status);
  auth.access_token = providerAccessToken;
  auth.last_status = status;
  auth.last_status_created_at = Date.now();
  api.user.setAppMetadata('auth', auth);
  console.log('Finished');
  return providerAccessToken;
}

/**
 * Handler that will be invoked when this action is resuming after an external redirect. If your
 * onExecutePostLogin function does not perform a redirect, this function can be safely ignored.
 *
 * @param {Event} event - Details about the user and the context in which they are logging in.
 * @param {PostLoginAPI} api - Interface whose methods can be used to change the behavior of the login.
 */
// exports.onContinuePostLogin = async (event, api) => {
// };
