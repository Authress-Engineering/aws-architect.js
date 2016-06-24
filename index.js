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
			//find all resources/verbs and publish them to API gateway
			Object.keys(this.Api.Routes).map(method => {
				Object.keys(this.Api.Routes[method]).map(resourcePath => {

				});
			});
			var lambdaArn = lambdaArn;

			var updateRestApiPromise = apiGatewayFactory.putRestApi({
				body: JSON.stringify(SwaggerBody(this.PackageMetaData.name, this.PackageMetaData.version, lambdaArn)),
				restApiId: apiGatewayId,
				failOnWarnings: true,
				mode: 'overwrite'
			}).promise();

			if(this.Api.Authorizer.Options.AuthorizationHeaderName) {
				//Set the authorizer for each route as well.
			}

			console.log(JSON.stringify(result, null, 2));
			return updateRestApiPromise;
		}
		catch (exception) {
			return Promise.reject({Error: 'Failed updating API Gateway.', Details: exception.stack || exception});
		}
	});
};

function SwaggerBody (name, version, lambdaArn) {
	return {
		swagger: '2.0',
		info: {
			'version': `${version}.${new Date().toISOString()}`,
			'title': name
		},
		paths: {
			'/': {
				'get': {
					'consumes': ['application/json'],
					'produces': ['application/json'],
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
					'responses': {
						'200': {
							'description': '200 response',
							'schema': {
								'$ref': '#/definitions/Empty'
							}
						},
						'300': {
							'description': '300 response',
							'schema': {
								'$ref': '#/definitions/Empty'
							}
						},
						'400': {
							'description': '400 response',
							'schema': {
								'$ref': '#/definitions/Empty'
							}
						},
						'500': {
							'description': '500 response',
							'schema': {
								'$ref': '#/definitions/Empty'
							}
						}
					},
					'x-amazon-apigateway-integration': {
						'responses': {
							'default': {
								'statusCode': '200',
								'responseParameters': {
									//'method.response.header.Access-Control-Allow-Origin': '\'*\''
								}
							},
							'.*\"statusCode\":300.*': {
								'statusCode': '300',
								'responseParameters': {
									//'method.response.header.Access-Control-Allow-Origin': '\'*\''
								}
							},
							'.*\"statusCode\":400.*': {
								'statusCode': '400',
								'responseParameters': {
									//'method.response.header.Access-Control-Allow-Origin': "'*'"
								}
							},
							'.*\"statusCode\":500.*': {
								'statusCode': '500',
								'responseParameters': {
									//'method.response.header.Access-Control-Allow-Origin': "'*'"
								}
							},
						},
						'uri': lambdaArn,
						/* Authorizer: http://docs.aws.amazon.com/apigateway/latest/developerguide/api-gateway-swagger-extensions.html
							'authorizerUri': lambdaArn,
						*/
						'passthroughBehavior': 'when_no_templates',
						'httpMethod': 'POST',
						'type': 'aws'
					}
				}
			}
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
		}
	};
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