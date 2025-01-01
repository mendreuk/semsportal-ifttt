function login(email, password, callback) {
    const request = require('request');
  
  request.post({
    url: 'https://eu.semsportal.com/api/v2/Common/CrossLogin',
    headers: {
        'Token': '{"version":"v3.1","client":"ios","language":"en"}'
    },
    json: {
      account: email,
      pwd: password
    }
    //for more options check:
    //https://github.com/mikeal/request#requestoptions-callback
  }, function(err, response, body) {
    if (err) return callback(err);
    if (response.statusCode >= 400) return callback(response.statusCode);
    if (body.code !== 0) return callback(body.code);
    
    callback(null, {
      user_id: body.data.uid,
      email: email,
      user_metadata: {
        svc_name: 'semsportal',
        svc_password: Buffer.from(password).toString('base64')
      }
    });
  });
}