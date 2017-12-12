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
		return Promise.reject({ title: 'PublicKey-Resolution-Failure', kid: kid, keys: result.data.keys });
	});
};

api.SetAuthorizer((authorizationTokenInfo, methodArn) => {
	var unverifiedToken = jwtManager.decode(authorizationTokenInfo.Token, {complete: true});
	var kid = ((unverifiedToken || {}).header || {}).kid;
	return GetPublicKeyPromise(kid)
	.then(key => {
		try { return jwtManager.verify(authorizationTokenInfo.Token, key, { algorithms: ['RS256'] }); }
		catch (exception) { return Promise.reject(exception.stack || exception.toString()); }
	})
	.then(token => {
		return {
			"principalId": token.sub,
			"policyDocument": {
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
			}
		};
	})
	.catch(error => Promise.reject('Custom-Authorizer-Failure'));
});

api.any('/{proxy+}', (event, context) => {
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
					"proxy": "a/b/c"
				},
				"stageVariables": null,
				"requestContext": {
					"accountId": "aws",
					"resourceId": "wagagr",
					"stage": "test-invoke-stage",
					"requestId": "test-invoke-request",
					"identity": {
						"cognitoIdentityPoolId": null,
						"accountId": "aws",
						"cognitoIdentityId": null,
						"caller": "caller",
						"apiKey": "test-invoke-api-key",
						"sourceIp": "test-invoke-source-ip",
						"cognitoAuthenticationType": null,
						"cognitoAuthenticationProvider": null,
						"userArn": "userarn",
						"userAgent": "agent",
						"user": "user"
					},
					"resourcePath": "/{proxy+}",
					"httpMethod": "GET",
					"apiId": "apiId"
				},
				"body": null
			}
		}
	*/
	//Or just return a body.
	return new Api.Response({ 'field': 'hello world' }, 200, { 'Content-Type': 'application/json' });
});