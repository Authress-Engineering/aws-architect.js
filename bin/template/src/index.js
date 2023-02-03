const Api = require('openapi-factory');
const path = require('path');
const fs = require('fs-extra');
const { TokenVerifier } = require('authress-sdk');

const api = new Api({
  requestMiddleware(request) {
    console.log(JSON.stringify({ title: 'RequestLogger', level: 'INFO', request: request }));
    return request;
  }
});
module.exports = api;

api.onEvent(trigger => {});
api.onSchedule(trigger => {});

api.setAuthorizer(async request => {
  try {
    const userToken = request.headers.Authorization.split(' ')[1];
    // What should my url be? => https://authress.io/app/#/setup?focus=domain
    // https://github.com/authress/authress-sdk.js
    const userIdentity = await TokenVerifier('https://authorization.domain.com', userToken);
    return userIdentity;
  } catch (error) {
    console.log('User is unauthorized', error);
    return { statusCode: 401 };
  }
});

api.get('/.well-known/openapi.json', async () => {
  let openapiFile = path.join(__dirname, './openapi.json');
  let data = await fs.readJson(openapiFile);
  return { statusCode: 200, body: data };
});

api.get('/livecheck', () => {
  return { statusCode: 200, body: { field: 'hello world' } };
});

api.get('/v1/resource/{resourceId}', request => {
  return { statusCode: 200, body: { resourceId: request.pathParameters.resourceId }, headers: { 'Content-Type': 'application/json' } };
});

api.options('/{proxy+}', request => {
  return {
    statusCode: 200,
    headers: {
      'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key',
      'Access-Control-Allow-Methods': 'DELETE,GET,HEAD,OPTIONS,PATCH,POST,PUT',
      'Access-Control-Allow-Origin': request.headers.Origin || '*'
    }
  };
});

api.any('/{proxy+}', request => {
  /*
		{
			request: {
				"resource": "/{proxy+}",
				"path": "/a/b/c",
				"httpMethod": "GET",
				"headers": {
					"Content-type": " application/json"
				},
				"queryStringParameters": {
					"param1": "1"
				},
				"pathParameters": {
					"resourceId": "123"
				},
				"stageVariables": null,
				"requestContext": {
					"authorizer": {
						"principalIdId": "USER-TOKEN-SUB"
					},
					"accountId": "aws",
					"resourceId": "wagagr",
					"stage": "test-invoke-stage",
					"requestId": "test-invoke-request",
					"identity": {...},
					"resourcePath": "/{proxy+}",
					"httpMethod": "GET",
					"apiId": "apiId"
				},
				"body": null
			}
		}
	*/
  return { statusCode: 404 };
});
