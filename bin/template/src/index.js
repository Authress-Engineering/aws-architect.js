const aws = require('aws-sdk');
const Api = require('openapi-factory');
const path = require('path');
const fs = require('fs-extra');
const { Authorizer, RequestLogger, PlatformClient } = require('microservice-utilities');

let logger = new RequestLogger();
const api = new Api({
	requestMiddleware(request) {
		logger.log({ title: 'RequestLogger', level: 'INFO', request: request });
		let userToken = request.requestContext.authorizer && request.requestContext.authorizer.jwt;
		request.userPlatformClient = new PlatformClient(msg => logger.log(msg), () => userToken);
		return request;
	}
});
module.exports = api;

const authorizerConfiguration = { jwkKeyListUrl: 'https://authorization.domain.com/.well-known/jwks.json' };
let authorizer = new Authorizer(msg => logger.log(msg), authorizerConfiguration);

api.onEvent(trigger => {});
api.onSchedule(trigger => {});

api.setAuthorizer(request => {
	return authorizer.getPolicy(request);
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
