var aws = require('aws-sdk');

function ApiGatewayManager (serviceName, version, apiGatewayFactory) {
	this.ServiceName = serviceName;
	this.Version = version;
	this.ApiGatewayFactory = apiGatewayFactory;
}

ApiGatewayManager.prototype.GetApiGatewayPromise = function() {
	var apiGatewayFactory = this.ApiGatewayFactory;
	return apiGatewayFactory.getRestApis({ limit: 500 }).promise()
	.then((apis) => {
		var serviceApi = apis.items.find((api) => api.name === this.ServiceName);
		if(!serviceApi) {
			return apiGatewayFactory.createRestApi({ name: this.ServiceName }).promise()
			.then((data) => {
				return { Id: data.id, Name: data.name };
			}, (error) => {
				return Promise.reject({Error: 'Failed to create API Gateway', Detail: error.stack || error});
			});
		}
		return { Id: serviceApi.id, Name: serviceApi.name };
	});
}

ApiGatewayManager.prototype.RemoveStagePromise = function(restApiId, stageName) {
	var params = {
		restApiId: restApiId,
		stageName: stageName
	};
	return this.ApiGatewayFactory.deleteStage(params).promise();
}

ApiGatewayManager.prototype.DeployStagePromise = function(restApiId, stageName, stage, lambdaVersion) {
	return this.ApiGatewayFactory.createDeployment({
		restApiId: restApiId,
		stageName: stageName,
		description: `${stage} (lambdaVersion: ${lambdaVersion})`,
		variables: {
			lambdaVersion: stageName
		}
	}).promise()
	.then(success => {
		return {
			Title: `Created Deployment stage: ${stageName}@${lambdaVersion}`,
			Stage: stage,
			LambdaVersion: lambdaVersion,
			DeploymentId: success.id
		};
	})
	.catch(failure => {
		return Promise.reject({
			Title: `Failed creating Deployment stage: ${stageName}@${lambdaVersion}`,
			Details: failure
		});
	});
};

ApiGatewayManager.prototype.PutRestApiPromise = function(api, lambdaArn, apiGatewayId) {
	var swaggerBody = this.GetSwaggerBody(api, this.ServiceName, this.Version, lambdaArn);
	return this.ApiGatewayFactory.putRestApi({
		body: JSON.stringify(swaggerBody),
		restApiId: apiGatewayId,
		failOnWarnings: true,
		mode: 'overwrite'
	}).promise();
}
ApiGatewayManager.prototype.GetSwaggerBody = function(api, name, version, lambdaArn) {
	var swaggerTemplate = {
		swagger: '2.0',
		info: {
			'version': `${version}.${new Date().toISOString()}`,
			'title': name
		},
		schemes: [ 'https' ],
		'securityDefinitions': {
			'sigv4': {
				'type': 'apiKey',
				'name': 'Authorization',
				'in': 'header',
				'x-amazon-apigateway-authtype': 'awsSigv4'
			},
			'AWS-Architect-Authorizer': {
				'type': 'apiKey',
				'name': api.Authorizer.Options.AuthorizationHeaderName || 'Authorization',
				'in': 'header',
				'x-amazon-apigateway-authtype': 'custom',
				'x-amazon-apigateway-authorizer': {
					'authorizerResultTtlInSeconds': Number(api.Authorizer.Options.CacheTimeout) || 300,
					'authorizerUri': lambdaArn,
					'type': 'token'
				}
			}
		},
		'definitions': {
			'Empty': {
				'type': 'object'
			}
		},
		paths: {}
	};

	Object.keys(api.Routes).map(method => {
		Object.keys(api.Routes[method]).map(resourcePath => {
			if(!swaggerTemplate.paths[resourcePath]) {
				swaggerTemplate.paths[resourcePath] = {
					"options": {
						"consumes": [
						  "application/json"
						],
						"produces": [
						  "application/json"
						],
						"responses": {
						  "200": {
							"description": "200 response",
							"schema": {
							  "$ref": "#/definitions/Empty"
							},
							"headers": {
							  "Access-Control-Allow-Origin": {
								"type": "string"
							  },
							  "Access-Control-Allow-Methods": {
								"type": "string"
							  },
							  "Access-Control-Allow-Headers": {
								"type": "string"
							  }
							}
						  }
						},
						"x-amazon-apigateway-integration": {
						  "responses": {
							"default": {
							  "statusCode": "200",
							  "responseParameters": {
								"method.response.header.Access-Control-Allow-Methods": "'DELETE,GET,HEAD,OPTIONS,PATCH,POST,PUT'",
								"method.response.header.Access-Control-Allow-Headers": "'Content-Type,Authorization,X-Amz-Date,X-Api-Key,X-Amz-Security-Token'",
								"method.response.header.Access-Control-Allow-Origin": "'*'"
							  }
							}
						  },
						  "requestTemplates": {
							"application/json": "{\"statusCode\": 200}"
						  },
						  "passthroughBehavior": "when_no_match",
						  "type": "mock"
						}
					  },
				};
			}
			var methodNormalize = method.toLowerCase().match('any') ? 'x-amazon-apigateway-any-method' : method.toLowerCase();
			swaggerTemplate.paths[resourcePath][methodNormalize] = {
				consumes: ['application/json'],
				produces: ['application/json'],
				'parameters': [
					{
						'name': resourcePath.replace(/[^a-zA-Z0-9._$-]/g, ''),
						'in': 'path',
						'required': true,
						'type': 'string'
					}
				],
				responses: {},
				'x-amazon-apigateway-integration': {
					responses: {
						default: {
							statusCode: '200'
						}
					},
					'uri': lambdaArn,
					'passthroughBehavior': 'when_no_templates',
					'httpMethod': 'POST',
					'type': 'aws_proxy'
					// "cacheNamespace": "wagagr",
					// "cacheKeyParameters": [
					// 	"method.request.path.proxy"
					// ]
				}
			};

			if(api.Authorizer.AuthorizerFunc) {
				swaggerTemplate.paths[resourcePath][methodNormalize].security = [
					{
						'AWS-Architect-Authorizer': []
					}
				];
			}
		});
	});
	return swaggerTemplate;
}
module.exports = ApiGatewayManager;