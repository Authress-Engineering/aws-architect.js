'use strict';

var archiver = require('archiver');
var aws = require('aws-sdk');
var exec = require('child_process').exec;
var fs = require('fs-extra');
var path = require('path');
var os = require('os');
var uuid = require('uuid');

var Server = require('./lib/server');

function AwsArchitect(contentDirectory, sourceDirectory) {
	this.ContentDirectory = contentDirectory;
	this.SourceDirectory = sourceDirectory;
	this.Api = require(path.join(sourceDirectory, 'index'));

	//TODO: Assume that the src directory is one level down from root, figure out how to find this automatically by the current location.
	var packageMetadataFile = path.join(path.dirname(this.SourceDirectory), 'package.json');
	this.PackageMetaData = require(packageMetadataFile);
}

function GetAccountIdPromise() {
	return new aws.IAM().getUser({}).promise().then((data) => data.User.Arn.split(':')[4]);
}

AwsArchitect.prototype.PublishPromise = function() {
	var region = this.Api.Configuration.Regions[0];
	var serviceName = this.PackageMetaData.name;
	var apiGatewayFactory = new aws.APIGateway({region: region});
	var apiGatewayPromise = apiGatewayFactory.getRestApis({ limit: 500 }).promise()
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

	var lambdaPromise = new Promise((s, f) => {
		fs.stat(this.SourceDirectory, (error, stats) => {
			if(error) { return f({Error: `Path does not exist: ${this.SourceDirectory} - ${error}`}); }
			if(!stats.isDirectory) { return f({Error: `Path is not a directory: ${this.SourceDirectory}`}); }
			return s(null);
		});
	})
	.then(() => new Promise((s, f) => {
		var tmpDir = path.join(os.tmpdir(), `lambda-${uuid.v4()}`);
		fs.copy(this.SourceDirectory, tmpDir, error => {
			return error ? f(error) : s(tmpDir);
		});
	}))
	.then((tmpDir) => new Promise((s, f) => {
		fs.writeFile(path.join(tmpDir, 'package.json'), JSON.stringify(this.PackageMetaData), (error, data) => {
			return error ? f({Error: 'Failed writing production package.json file.', Details: error}) : s(tmpDir);
		})
	}))
	.then((tmpDir) => new Promise((s, f) => {
		exec('npm install --production', { cwd: tmpDir }, (error, stdout, stderr) => {
			if(error) { return f({Error: 'Failed installing production npm modules.', Details: error}) }
			return s(tmpDir);
		});
	}))
	.then((tmpDir) => new Promise((s, f) => {
		var zipArchivePath = path.join(tmpDir, 'lambda.zip');
		var zipStream = fs.createWriteStream(zipArchivePath);
		zipStream.on('close', () => s({Archive: zipArchivePath}));

		var archive = archiver.create('zip', {});
		archive.on('error', (e) => f({Error: e}));
		archive.pipe(zipStream);
		archive.glob('**', {dot: true, cwd: tmpDir, ignore: 'lambda.zip'});
		archive.finalize();
	}))
	.then((zipInformation) => {
		var awsLambdaPublisher = new aws.Lambda({region: region});
		var configuration = this.Api.Configuration;
		var functionName = `${serviceName}-${configuration.FunctionName}`;

		return awsLambdaPublisher.listVersionsByFunction({ FunctionName: functionName, MaxItems: 1 }).promise().then((data) => {
			return awsLambdaPublisher.updateFunctionCode({
				FunctionName: functionName,
				Publish: true,
				ZipFile: fs.readFileSync(zipInformation.Archive)
			}).promise();
		}).catch((failure) => {
			return GetAccountIdPromise().then((accountId) => {
				return awsLambdaPublisher.createFunction({
					FunctionName: functionName,
					Code: { ZipFile: fs.readFileSync(zipInformation.Archive) },
					Handler: configuration.Handler,
					Role: `arn:aws:iam::${accountId}:role/${configuration.Role}`,
					Runtime: configuration.Runtime,
					Description: configuration.Description,
					MemorySize: configuration.MemorySize,
					Publish: configuration.Publish,
					Timeout: configuration.Timeout
				}).promise()
			});
		})
		.catch((error) => {
			return Promise.reject({Error: error, Detail: error.stack});
		});
	});

	return Promise.all([lambdaPromise, apiGatewayPromise])
	.then(result => {
		try {
			var lambda = result[0];
			var lambdaArn = lambda.FunctionArn;
			var lambdaVersion = lambda.Version;
			var apiGateway = result[1];
			var apiGatewayId = apiGateway.Id;

			var lambdaArnStagedVersioned = lambdaArn; //lambdaArn.replace(`:${lambdaVersion}`, ':${stageVariables.lambdaVersion}');
			var lambdaFullArn = `arn:aws:apigateway:${region}:lambda:path/2015-03-31/functions/${lambdaArnStagedVersioned}/invocations`;
			console.log(lambdaFullArn);
			var updateRestApiPromise = apiGatewayFactory.putRestApi({
				body: JSON.stringify(SwaggerBody(this.Api, this.PackageMetaData.name, this.PackageMetaData.version, lambdaFullArn)),
				restApiId: apiGatewayId,
				failOnWarnings: true,
				mode: 'overwrite'
			}).promise();

			console.log(JSON.stringify(result, null, 2));
			return updateRestApiPromise;
		}
		catch (exception) {
			return Promise.reject({Error: 'Failed updating API Gateway.', Details: exception.stack || exception});
		}
	});
};

AwsArchitect.prototype.DeployStagePromise = function() {

};

function SwaggerBody (api, name, version, lambdaArn) {
	if(api.Authorizer.Options.AuthorizationHeaderName) {
		//Set the authorizer for each route as well.
		//`method.request.header.${this.Api.Authorizer.Options.AuthorizationHeaderName}`;
	}

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
	var defaultAmazonIntegrations = { default: { statusCode: '200' } };

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
					/* Authorizer: http://docs.aws.amazon.com/apigateway/latest/developerguide/api-gateway-swagger-extensions.html
						'authorizerUri': lambdaArn,
					*/
					'passthroughBehavior': 'when_no_templates',
					'httpMethod': 'POST',
					'type': 'aws',
					"requestTemplates": {
						"application/json": "#set($allParams = $input.params())\n{\n    \"body\" : $input.json('$'),\n    \"headers\": {\n    #set($params = $allParams.get('header'))\n    #foreach($paramName in $params.keySet())\n    \"$paramName\" : \"$util.escapeJavaScript($params.get($paramName))\"#if($foreach.hasNext),\n    #end\n    #end\n    },\n    \"queryString\": {\n    #set($params = $allParams.get('querystring'))\n    #foreach($paramName in $params.keySet())\n    \"$paramName\" : \"$util.escapeJavaScript($params.get($paramName))\"#if($foreach.hasNext),\n    #end\n    #end\n    },\n    \"params\": {\n    #set($params = $allParams.get('path'))\n    #foreach($paramName in $params.keySet())\n    \"$paramName\" : \"$util.escapeJavaScript($params.get($paramName))\"#if($foreach.hasNext),\n    #end\n    #end\n    },\n    \"stage-variables\" : {\n    #foreach($key in $stageVariables.keySet())\n    \"$key\" : \"$util.escapeJavaScript($stageVariables.get($key))\"#if($foreach.hasNext),\n    #end\n    #end\n    }\n}\n"
					},
				}
			};
		});
	});
	return swaggerTemplate;
}

AwsArchitect.prototype.UpdateStagePromise = function(stage, lambdaVersion) {
	var region = this.Api.Configuration.Regions[0];
};

AwsArchitect.prototype.Run = function() {
	try {
		new Server(this.ContentDirectory, this.Api).Run();
		return Promise.resolve({Message: 'Server started successfully'});
	}
	catch (exception) {
		return Promise.reject({Error: 'Failed to start server', Exception: exception});
	}
};


module.exports = AwsArchitect;