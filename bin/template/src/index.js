var aws = require('aws-sdk');
var Api = require('node-openapi-factory');

var api = new Api({
  description: 'This is the description of the lambda function',
  regions: ['us-east-1'],
  role: 'LAMBDA_EXECUTION_IAM_ROLE',
  runtime: 'nodejs4.3',
  memorySize: 128,
  publish: true,
  timeout: 3
}, __filename);

module.exports = api;

api.Authorizer((authorizationToken, methodArn, principalId) => {
  return {
    principalId: principalId,
    policyDocument: {
      Version: '2012-10-17',
      Statement: [
        {
          Action: 'execute-api:Invoke',
          Effect: 'Deny',
          Resource: methodArn
        }
      ]
    }
  }
});

api.get('/test', (request) => {
  return {'Value': 1};
});

api.post('/test', (request) => {
  throw {'Value': 'Exception results'};
});

//Specialized return type to handle status and headers
api.get('/orders', (request) => {
  return Api.Response({Id: 1}, {'X-Custom-Header': 'HeaderValue'}, 200);
});

//Use a promise
api.get('/ordersAsync', (request) => {
  console.log(request.headers);
  console.log(request.body);
  console.log(request.queryString);

  //AWS Lambda Context
  console.log(request.context);
  return Promise.resolve(Api.Response({Id: 1}, {'Content-Type': 'application/json'}, 200));
});