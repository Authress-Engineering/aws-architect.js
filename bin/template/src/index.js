const aws = require('aws-sdk');
const Api = require('openapi-factory');
const jwtManager = require('jsonwebtoken');
const jwkConverter = require('jwk-to-pem');
const axios = require('axios');

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

api.SetAuthorizer(event => {
	let methodArn = event.methodArn;
	let token = event.headers.Authorization ? event.headers.Authorization.split(' ')[1] : null;
	let unverifiedToken = jwtManager.decode(token, {complete: true});
	var kid = ((unverifiedToken || {}).header || {}).kid;
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

api.get('/resource/{resourceId}', (event, context) => {
	/*
		{
			event: {
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
	// Return a body.
	return new Api.Response({ resourceId: event.pathParameters.resourceId }, 200, { 'Content-Type': 'application/json' });
});