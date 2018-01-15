'use strict';
/*
	Automatically configure microservice in AWS
	Copyright (C) 2017 Warren Parad
	
	This program is free software: you can redistribute it and/or modify
	it under the terms of the GNU General Public License as published by
	the Free Software Foundation, either version 3 of the License, or
	(at your option) any later version.
	
	This program is distributed in the hope that it will be useful,
	but WITHOUT ANY WARRANTY; without even the implied warranty of
	MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
	GNU General Public License for more details.
	
	You should have received a copy of the GNU General Public License
	along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

var archiver = require('archiver');
var aws = require('aws-sdk');
var exec = require('child_process').exec;
var fs = require('fs-extra');
var path = require('path');
var os = require('os');
var uuid = require('uuid');
var Api = require('openapi-factory');
var http = require('http');
var _ = require('lodash');

var Server = require('./lib/server');
var ApiGatewayManager = require('./lib/ApiGatewayManager');
var DynamoDbManager = require('./lib/DynamoDbManager');
var LambdaManager = require('./lib/LambdaManager');
var ApiConfiguration = require('./lib/ApiConfiguration');
var BucketManager = require('./lib/BucketManager');
var IamManager = require('./lib/IamManager');
let CloudFormationDeployer = require('./lib/CloudFormationDeployer');
let LockFinder = require('./lib/lockFinder');

function AwsArchitect(packageMetadata, apiOptions, contentOptions) {
	this.PackageMetadata = packageMetadata;
	this.ContentOptions = contentOptions || {};
	this.SourceDirectory = (apiOptions || {}).sourceDirectory;
	this.UseCloudFormation = (apiOptions || {}).useCloudFormation;

	var apiList = [];
	var indexPathExists = true;
	try {
		var indexPath = path.join(apiOptions.sourceDirectory, 'index.js');
		fs.accessSync(indexPath);
	}
	catch (exception) { indexPathExists = false; }
	if(indexPathExists) {
		apiList.push(require(indexPath));
	}
	else {
		apiList.push(new Api());
	}
	this.Api = apiList[0];
	this.Configuration = new ApiConfiguration(apiOptions, 'index.js', aws.config.region || 'us-east-1');

	if(this.Configuration.Regions.length === 0) { throw new Error('A single region must be defined in the apiOptions.'); }
	if(this.Configuration.Regions.length > 1) { throw new Error('Only deployments to a single region are allowed at this time.'); }
	this.Region = this.Configuration.Regions[0];

	var apiGatewayFactory = new aws.APIGateway({region: this.Region});
	this.ApiGatewayManager = new ApiGatewayManager(this.PackageMetadata.name, this.PackageMetadata.version, apiGatewayFactory);

	var lambdaFactory = new aws.Lambda({region: this.Region});
	this.LambdaManager = new LambdaManager(this.PackageMetadata.name, lambdaFactory, this.Configuration);

	var dynamoDbFactory = new aws.DynamoDB({region: this.Region});
	this.DynamoDbManager = new DynamoDbManager(this.PackageMetadata.name, dynamoDbFactory);

	var s3Factory = new aws.S3({region: this.Region});
	this.BucketManager = new BucketManager(s3Factory, this.ContentOptions.bucket);

	var iamFactory = new aws.IAM({region: this.Region})
	this.IamManager = new IamManager(iamFactory, null, this.UseCloudFormation);

	let cloudFormationClient = new aws.CloudFormation({ region: this.Region });
	this.CloudFormationDeployer = new CloudFormationDeployer(cloudFormationClient);
}

function GetAccountIdPromise() {
	return new aws.IAM().getUser({}).promise()
	.then((data) => data.User.Arn.split(':')[4])
	.catch(() => {
		//assume EC2 instance profile
		return new Promise((s, f) => {
			http.get('http://169.254.169.254/latest/dynamic/instance-identity/document', res => {
				if(res.statusCode >= 400) { return Promise.reject('Failed to lookup AWS AccountID, please specify by running as IAM user or with credentials.'); }
				var data = '';
				res.on('data', chunk => {
					data += chunk;
				});
				res.on('end', () => {
					try {
						var json = JSON.parse(data);
						s(json.accountId)
					}
					catch (exception) {
						f(JSON.stringify({ Title: 'Failure trying to parse AWS AccountID from metadata', Error: exception.stack || exception.toString(), Details: exception, Response: data }));
					}
				});
				res.on('error', error => f(error));
			});
		});
	})
}

AwsArchitect.prototype.GetApiGatewayPromise = function() {
	return this.ApiGatewayManager.GetApiGatewayPromise();
}

AwsArchitect.prototype.PublishLambdaArtifactPromise = function(options = {}) {
	let lambdaZip = 'lambda.zip';
	var tmpDir = path.join(os.tmpdir(), `lambda-${uuid.v4()}`);
	let zipArchiveInformationPromise = new Promise((s, f) => {
		fs.stat(this.SourceDirectory, (error, stats) => {
			if(error) { return f({Error: `Path does not exist: ${this.SourceDirectory} - ${error}`}); }
			if(!stats.isDirectory) { return f({Error: `Path is not a directory: ${this.SourceDirectory}`}); }
			return s(null);
		});
	})
	.then(() => {
		let sourceDirCopyPromise = fs.copy(this.SourceDirectory, tmpDir);
		let lockFilePromise = new LockFinder().findLockFile(this.SourceDirectory)
		.then(lockFile => {
			return lockFile ? fs.copy(lockFile.file, path.join(tmpDir, path.basename(lockFile.file))) : Promise.resolve();
		});
		return Promise.all([sourceDirCopyPromise, lockFilePromise]);
	})
	.then(() => {
		return fs.writeJson(path.join(tmpDir, 'package.json'), this.PackageMetadata)
		.catch(error => ({Error: 'Failed writing production package.json file.', Details: error}));
	})
	.then(() => {
		return fs.pathExists(path.join(tmpDir, 'yarn.lock')).catch(err => false)
		.then(exists => {
			let cmd = exists ? 'yarn --prod --frozen-lockfile' : 'npm install --production';
			return new Promise((s, f) => {
				exec(cmd, { cwd: tmpDir }, (error, stdout, stderr) => {
					if(error) { return f({Error: 'Failed installing production npm modules.', Details: error}) }
					return s(tmpDir);
				});
			});
		});
	})
	.then(() => new Promise((s, f) => {
		var zipArchivePath = path.join(tmpDir, lambdaZip);
		var zipStream = fs.createWriteStream(zipArchivePath);
		zipStream.on('close', () => s({Archive: zipArchivePath}));

		var archive = archiver.create('zip', {});
		archive.on('error', (e) => f({Error: e}));
		archive.pipe(zipStream);
		archive.glob('**', {dot: true, cwd: tmpDir, ignore: lambdaZip});
		archive.finalize();
	}));

	return zipArchiveInformationPromise
	.then(zipInformation => {
		if (options.bucket) {
			return this.BucketManager.DeployLambdaPromise(options.bucket, zipInformation.Archive, `${this.PackageMetadata.name}/${this.PackageMetadata.version}/${lambdaZip}`);
		}
	}).then(() => zipArchiveInformationPromise);
}

AwsArchitect.prototype.PublishPromise = function() {
	var accountIdPromise = GetAccountIdPromise();

	var serviceRoleName = this.Configuration.Role || this.PackageMetadata.name;
	var lambdaPromise = this.IamManager.EnsureServiceRole(serviceRoleName, this.PackageMetadata.name, '*')
	.then(() => {
		return this.PublishLambdaArtifactPromise();
	})
	.then((zipInformation) => {
		return accountIdPromise.then(accountId => this.LambdaManager.PublishLambdaPromise(accountId, zipInformation.Archive, serviceRoleName));
	});

	var apiGatewayPromise = this.ApiGatewayManager.GetApiGatewayPromise();
	return Promise.all([lambdaPromise, apiGatewayPromise, accountIdPromise])
	.then(result => {
		try {
			var lambda = result[0];
			var lambdaArn = lambda.FunctionArn;
			var lambdaVersion = lambda.Version;
			var apiGateway = result[1];
			var apiGatewayId = apiGateway.Id;
			var accountId = result[2];

			var permissionsPromise = accountIdPromise.then(accountId => this.LambdaManager.SetPermissionsPromise(accountId, lambdaArn, apiGatewayId, this.Region));

			var lambdaArnStagedVersioned = lambdaArn.replace(`:${lambdaVersion}`, ':${stageVariables.lambdaVersion}');
			var lambdaFullArn = `arn:aws:apigateway:${this.Region}:lambda:path/2015-03-31/functions/${lambdaArnStagedVersioned}/invocations`;
			//Ignore non-openapi objects
			var updateRestApiPromise = this.Api.Routes && !this.UseCloudFormation ? this.ApiGatewayManager.PutRestApiPromise(this.Api, lambdaFullArn, apiGatewayId) : Promise.resolve();

			return Promise.all([updateRestApiPromise, permissionsPromise])
			.then(result => {
				return {
					LambdaFunctionArn: lambdaArn,
					LambdaVersion: lambdaVersion,
					RestApiId: apiGatewayId
				};
			});
		}
		catch (exception) {
			return Promise.reject({Error: 'Failed updating API Gateway.', Details: exception.stack || exception});
		}
	});
};

AwsArchitect.prototype.ValidateTemplate = function(stackTemplate) {
	return this.CloudFormationDeployer.validateTemplate(stackTemplate);
}

AwsArchitect.prototype.DeployTemplate = function(stackTemplate, stackConfiguration, parameters) {
	return this.CloudFormationDeployer.deployTemplate(stackTemplate, stackConfiguration, parameters);
}

AwsArchitect.prototype.DeployStagePromise = function(stage, lambdaVersion) {
	if(!stage) { throw new Error('Deployment stage is not defined.'); }
	if(!lambdaVersion) { throw new Error('Deployment lambdaVersion is not defined.'); }
	return this.ApiGatewayManager.GetApiGatewayPromise()
	.then(result => result.Id)
	.then(restApiId => this.ApiGatewayManager.DeployStagePromise(restApiId, stage, lambdaVersion));
};

AwsArchitect.prototype.PublishDatabasePromise = function(stage, databaseSchema) {
	if(!stage) { throw new Error('Deployment stage is not defined.'); }
	return this.DynamoDbManager.PublishDatabasePromise(stage, databaseSchema || []);
};

AwsArchitect.prototype.RemoveStagePromise = function(stage) {
	if(!stage) { throw new Error('Deployment stage is not defined.'); }
	var stageName = stage.replace(/[^a-zA-Z0-9_]/g, '_');
	let apiGatewayPromise = this.ApiGatewayManager.GetApiGatewayPromise();
	return apiGatewayPromise
	.then(result => this.ApiGatewayManager.RemoveStagePromise(result.Id, stageName))
	.then(result => ({
		title: 'Successfully delete stage',
		stage: stageName,
		details: result
	}));
}

AwsArchitect.prototype.PublishAndDeployStagePromise = function(options = {}) {
	let stage = options.stage;
	var stageName = stage.replace(/[^a-zA-Z0-9_]/g, '_');
	let functionName = options.functionName;
	let bucket = options.deploymentBucketName;
	let deploymentKey = options.deploymentKeyName;
	if(!stage) { throw new Error('Deployment stage is not defined.'); }
	
	let lambdaPromise = this.LambdaManager.PublishNewVersion(functionName, bucket, deploymentKey);
	let apiGatewayPromise = this.ApiGatewayManager.GetApiGatewayPromise();
	let accountIdPromise = GetAccountIdPromise();
	return Promise.all([lambdaPromise, apiGatewayPromise, accountIdPromise])
	.then(result => {
		try {
			var lambda = result[0];
			var lambdaArn = lambda.FunctionArn;
			var lambdaVersion = lambda.Version;
			var apiGateway = result[1];
			var apiGatewayId = apiGateway.Id;
			var accountId = result[2];

			return accountIdPromise
			.then(accountId => {
				return this.LambdaManager.SetAlias(functionName, stageName, lambdaVersion)
				.then(() => {
					return this.LambdaManager.SetPermissionsPromise(accountId, lambdaArn, apiGatewayId, this.Region, stageName);
				});
			})
			.then(result => {
				return {
					LambdaFunctionArn: lambdaArn,
					LambdaVersion: lambdaVersion,
					RestApiId: apiGatewayId
				};
			});
		}
		catch (exception) {
			throw ({Error: 'Failed updating API Gateway.', Details: exception.stack || exception});
		}
	})
	.then(result => {
		return this.ApiGatewayManager.DeployStagePromise(result.RestApiId, stageName, stage, result.LambdaVersion)
		.then(data => {
			return {
				LambdaResult: result,
				ApiGatewayResult: data,
				ServiceApi: `https://${result.RestApiId}.execute-api.${this.Region}.amazonaws.com/${stageName}`
			};
		});
	})
	.catch(failure => {
		return Promise.reject({Error: 'Failed to create and deploy updates.', Details: failure});
	});
}

AwsArchitect.prototype.PublishAndDeployPromise = function(stage, databaseSchema) {
	if(!stage) { throw new Error('Deployment stage is not defined.'); }

	return this.PublishPromise()
	.then(result => {
		var dynamoDbPublishPromise = this.DynamoDbManager.PublishDatabasePromise(stage, databaseSchema || []);
		var stageName = stage.replace(/[^a-zA-Z0-9_]/g, '_');
		return dynamoDbPublishPromise.then(database => this.ApiGatewayManager.DeployStagePromise(result.RestApiId, stageName, stage, result.LambdaVersion))
		.then(data => {
			return {
				LambdaResult: result,
				ApiGatewayResult: data,
				ServiceApi: `https://${result.RestApiId}.execute-api.${this.Region}.amazonaws.com/${stageName}`
			};
		});
	})
	.catch(failure => {
		return Promise.reject({Error: 'Failed to create and deploy updates.', Details: failure});
	});
};

AwsArchitect.prototype.PromoteToStage = function(source, stage) {
	if(!source) { throw new Error('Source directory key not defined.'); }
	if(!stage) { throw new Error('Stage directory key not defined.'); }
	return this.BucketManager.CopyBucket(source, stage);
};

AwsArchitect.prototype.PublishWebsite = function(version, optionsIn) {
	var options = _.merge({ configureBucket: true}, optionsIn);
	if(!this.BucketManager.Bucket) { throw new Error('Bucket in cotent options has not been defined.'); }
	if(!this.ContentOptions.contentDirectory) { throw new Error('Content directory is not defined.'); }
	if(!version) { throw new Error('Deployment version is not defined.'); }

	var deploymentPromise = Promise.resolve();
	if (options.configureBucket) {
		deploymentPromise = this.BucketManager.EnsureBucket(this.PackageMetadata.name, this.Region);
	}
	return deploymentPromise.then(() => this.BucketManager.Deploy(this.ContentOptions.contentDirectory, version, options.cacheControlRegexMap));
};

AwsArchitect.prototype.Run = function(port) {
	try {
		var resolvedPort = port || 80;
		new Server(this.ContentOptions.contentDirectory, this.Api).Run(resolvedPort);
		return Promise.resolve({Message: `Server started successfully at 'http://localhost:${resolvedPort}', lambda routes available at /api.`});
	}
	catch (exception) {
		return Promise.reject({ title: 'Failed to start server', error: exception.stack || exception});
	}
};


module.exports = AwsArchitect;