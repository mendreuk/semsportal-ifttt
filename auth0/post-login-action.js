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
  const svcAccessToken = await refreshSvcAccessToken(event, api);
  if (svcAccessToken) {
    api.accessToken.setCustomClaim(NAMESPACE + 'svc_access_token', svcAccessToken);
  }
  api.accessToken.setCustomClaim(NAMESPACE + 'email', event.user.email);
};

async function refreshSvcAccessToken(event, api) {
  console.log('Refresh started');
  const tokenOptions = {
    method: 'POST',
    url: `https://eu.semsportal.com/api/v2/Common/CrossLogin`,
    headers: { 'Token': '{"version":"v3.1","client":"ios","language":"en"}' },
    data: {
      account: event.user.email,
      pwd: Buffer.from(event.user.user_metadata.svc_password, 'base64').toString()
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
  let svcAccessToken;
  if (res && res.data && res.data.code == 0) {
    status = 'OK';
    svcAccessToken = Buffer.from(JSON.stringify(res.data.data)).toString('base64');
    api.user.setUserMetadata('svc_access_token', svcAccessToken);
  } else if (res && res.data) {
    status = res.data.code + " " + res.data.msg;
  }
  console.log('Returned', status);
  api.user.setUserMetadata('svc_last_token_refresh', Date.now());
  api.user.setUserMetadata('svc_last_status', status);
  console.log('Finished');
  return svcAccessToken;
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
