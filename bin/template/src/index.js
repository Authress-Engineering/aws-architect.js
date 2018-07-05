const aws = require('aws-sdk');
const Api = require('openapi-factory');
const jwtManager = require('jsonwebtoken');
const jwkConverter = require('jwk-to-pem');
const axios = require('axios');
const path = require('path');
const fs = require('fs-extra');

let api = new Api();
module.exports = api;

const jwkKeyListUrl = 'https://auth0.com/.well-known/jwks.json';
let publicKeysPromise = null;
function GetPublicKeyPromise(kid) {
	if(!publicKeysPromise) {
		publicKeysPromise = axios.get(jwkKeyListUrl);
	}
	return publicKeysPromise.then(result => {
		let jwk = result.data.keys.find(key => key.kid === kid);
		if(jwk) {
			return jwkConverter(jwk);
		}
		publicKeysPromise = null;
		return Promise.reject({ title: 'PublicKey-Resolution-Failure', kid: kid || 'NO_KID_SPECIFIED', keys: result.data.keys});
	});
};

api.SetAuthorizer(request => {
	let methodArn = request.methodArn;
	let authorization = Object.keys(request.headers).find(key => {
		return key.match(/^Authorization$/i);
	});
	let token = request.headers[authorization] ? request.headers[authorization].split(' ')[1] : null;
	let unverifiedToken = jwtManager.decode(token, {complete: true});
	let kid = ((unverifiedToken || {}).header || {}).kid;
	return GetPublicKeyPromise(kid)
	.then(key => {
		try { return jwtManager.verify(token, key, { algorithms: ['RS256'] }); }
		catch (exception) { return Promise.reject(exception.stack || exception.toString()); }
	})
	.then(token => {
		return {
			principalId: token.sub,
			policyDocument: {
				"Version": "2012-10-17",
				"Statement": [
					{
						"Effect": "Allow",
						"Action": [
							"execute-api:Invoke"
						],
						"Resource": [
							'arn:aws:execute-api:*:*:*'
						]
					}
				]
			},
			context: {
				stringKey: "stringval",
				numberKey: 123,
				booleanKey: true
			}
		};
	});
});

api.get('/.well-known/openapi.json', () => {
	let openapiFile = path.join(__dirname, './openapi.json');
	return fs.readJson(openapiFile)
	.then(data => new Api.Response(data, 200, {
		"Content-Type": "application/json",
		"Access-Control-Allow-Origin" : '*'
	}));
});

api.get('/livecheck', () => {
	return new Api.Response({ "field": "hello world" }, 200);
});

api.get('/v1/resource/{resourceId}', request => {
	return new Api.Response({ resourceId: request.pathParameters.resourceId }, 200, { 'Content-Type': 'application/json' });
});

api.options('/{proxy+}', request => {
	return new Api.Response({}, 200, {
		"Access-Control-Allow-Headers" : 'Content-Type,X-Amz-Date,Authorization,X-Api-Key',
		"Access-Control-Allow-Methods" : 'DELETE,GET,HEAD,OPTIONS,PATCH,POST,PUT',
		"Access-Control-Allow-Origin" : request.headers.Origin || '*'
	});
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
	return new Api.Response({ }, 404);
});
