var aws = require('aws-sdk');
var Api = require('openapi-factory');
var jwtManager = require('jsonwebtoken');

module.exports = api = new Api();

//Region must match KMS KEY
var kms = new aws.KMS({region: 'us-east-1'});
var encryptedAuth0Secret = 'ENCRYPTED_SECRET';
var decryptedAuth0SecretPromise = kms.decrypt({CiphertextBlob: new Buffer(encryptedAuth0Secret, 'base64')}).promise().then(data => data.Plaintext.toString('UTF-8'));

api.SetAuthorizer((authorizationTokenInfo, methodArn) => {
	return decryptedAuth0SecretPromise
	.then(key => {
		try { return jwtManager.verify(authorizationTokenInfo.Token, new Buffer(key, 'base64'), { algorithms: ['HS256'] }); }
		catch (exception) { return Promise.reject(exception.stack || exception.toString()) }
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
	return new Api.Response({ 'field': 'value' }, 200, { 'Content-Type': 'application/json' });
});