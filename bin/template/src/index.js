var aws = require('aws-sdk');
var Api = require('openapi-factory');
module.exports = api = new Api();

api.SetAuthorizer((authorizationToken, methodArn, principalId) => {
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