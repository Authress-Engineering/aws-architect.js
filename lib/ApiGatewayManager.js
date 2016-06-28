var aws = require('aws-sdk');

function ApiGatewayManager (apiGatewayFactory) {
	this.ApiGatewayFactory = apiGatewayFactory;
}

ApiGatewayManager.prototype.GetApiGatewayPromise = function(serviceName) {;
	var apiGatewayFactory = this.ApiGatewayFactory;
	return apiGatewayFactory.getRestApis({ limit: 500 }).promise()
	.then((apis) => {
		var serviceApi = apis.items.find((api) => api.name === serviceName);
		if(!serviceApi) {
			return apiGatewayFactory.createRestApi({ name: serviceName }).promise()
			.then((data) => {
				return { Id: data.id, Name: data.name };
			}, (error) => {
				return Promise.reject({Error: 'Failed to create API Gateway', Detail: error.stack || error});
			});
		}
		return { Id: serviceApi.id, Name: serviceApi.name };
	});
}
ApiGatewayManager.prototype.DeployStagePromise = function(restApiId, stage, lambdaVersion) {
	return this.ApiGatewayFactory.createDeployment({
		restApiId: restApiId,
		stageName: stage,
		variables: {
			lambdaVersion: lambdaVersion.toString()
		}
	}).promise()
	.then(success => {
		return {
			Title: `Created Deployment stage: ${stage}@${lambdaVersion}`,
			Stage: stage,
			LambdaVersion: lambdaVersion,
			Details: success
		};
	})
	.catch(failure => {
		return Promise.reject({
			Title: `Failed creating Deployment stage: ${stage}@${lambdaVersion}`,
			Details: failure
		});
	});
};

ApiGatewayManager.prototype.GetSwaggerBody = function(api, name, version, lambdaArn) {
	var swaggerTemplate = {
		swagger: '2.0',
		info: {
			'version': `${version}.${new Date().toISOString()}`,
			'title': name
		},
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

	//find all resources/verbs and publish them to API gateway
	var defaultResponses = {};
	var defaultAmazonIntegrations = {
		default: {
			statusCode: '200',
			"responseTemplates": {
				"application/json": "$input.path('$.errorMessage')"
			}
		}
	};

	[200, 201, 202, 203, 204, 205, 206,
	300, 301, 302, 303, 304, 305, 307, 308,
	400, 401, 402, 403, 404, 405, 406, 407, 408, 409, 410, 411, 412, 413, 414, 415, 416, 417, 418, 421, 426, 428, 429, 431,
	500, 501, 502, 503, 504, 505, 506, 507, 511].map(code => {
		defaultResponses[code] = {
			description: `${code} response`
		};
		defaultAmazonIntegrations[`.*"statusCode":${code}.*`] = {
			'statusCode': code.toString(),
			'responseParameters': {
				//'method.response.header.Access-Control-Allow-Origin': '\'*\''
			},
			"responseTemplates": {
				"application/json": "$input.path('$.errorMessage')"
			}
		};
	});
	Object.keys(api.Routes).map(method => {
		Object.keys(api.Routes[method]).map(resourcePath => {
			if(!swaggerTemplate.paths[resourcePath]) {
				swaggerTemplate.paths[resourcePath] = {
				/*
					'options': {
						'consumes': ['application/json'],
						'produces': ['application/json'],
						'responses': {
							'200': {
								'description': '200 response',
								'schema': {
									'$ref': '#/definitions/Empty'
								},
								'headers': {
									'Access-Control-Allow-Origin': { 'type': 'string' },
									'Access-Control-Allow-Methods': { 'type': 'string' },
									'Access-Control-Allow-Credentials': { 'type': 'string' },
									'Access-Control-Allow-Headers': { 'type': 'string' }
								}
							}
						},
						'x-amazon-apigateway-integration': {
							'requestTemplates': {
								'application/json': '{\'statusCode\': 200}'
							},
							'passthroughBehavior': 'when_no_match',
							'responses': {
								'default': {
									'statusCode': '200',
									'responseParameters': {
										'method.response.header.Access-Control-Allow-Credentials': "'true'",
										'method.response.header.Access-Control-Allow-Methods': "'HEAD,GET,OPTIONS,POST,PUT,PATCH,DELETE'",
										'method.response.header.Access-Control-Allow-Headers': "'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token'",
										'method.response.header.Access-Control-Allow-Origin': "'http://localhost'"
									}
								}
							},
							'type': 'mock'
						}
					}
				*/
				};
			}
			swaggerTemplate.paths[resourcePath][method.toLowerCase()] = {
				consumes: ['application/json'],
				produces: ['application/json'],
			/*
				'parameters': [
					{
						'name': 'Content-Type',
						'in': 'header',
						'required': false,
						'type': 'string'
					},
					{
						'name': 'id',
						'in': 'query',
						'required': false,
						'type': 'string'
					}
				],
			*/
				responses: defaultResponses,
				'x-amazon-apigateway-integration': {
					responses: defaultAmazonIntegrations,
					'uri': lambdaArn,
					'passthroughBehavior': 'when_no_templates',
					'httpMethod': 'POST',
					'type': 'aws',
					"requestTemplates": {
						"application/json": `#set($allParams = $input.params())
{
	"body" : $input.json('$'),
	"headers": {
		#set($params = $allParams.get('header'))
		#foreach($paramName in $params.keySet())
		"$paramName" : "$util.escapeJavaScript($params.get($paramName))"#if($foreach.hasNext),
	#end
	#end
},
	"queryString": {
	#set($params = $allParams.get('querystring'))
	#foreach($paramName in $params.keySet())
	"$paramName" : "$util.escapeJavaScript($params.get($paramName))"#if($foreach.hasNext),
	#end
	#end
	},
	"params": {
	#set($params = $allParams.get('path'))
	#foreach($paramName in $params.keySet())
	"$paramName" : "$util.escapeJavaScript($params.get($paramName))"#if($foreach.hasNext),
	#end
	#end
	},
	"variables" : {
	#foreach($key in $stageVariables.keySet())
	"$key" : "$util.escapeJavaScript($stageVariables.get($key))"#if($foreach.hasNext),
	#end
	#end
	},
	"api" : {
		"authorizerPrincipalId" : "$context.authorizer.principalId",
		"httpMethod" : "$context.httpMethod",
		"resourcePath" : "$context.resourcePath"
	}
}
`
					}
				}
			};

			if(api.Authorizer.Options.AuthorizationHeaderName) {
				swaggerTemplate.paths[resourcePath][method.toLowerCase()].security = [
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