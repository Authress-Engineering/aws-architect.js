'use strict';

var archiver = require('archiver');
var aws = require('aws-sdk');
var exec = require('child_process').exec;
var fs = require('fs-extra');
var path = require('path');
var os = require('os');
var uuid = require('uuid');

var Server = require('./lib/server');
var ApiGatewayManager = require('./lib/ApiGatewayManager');
var DynamoDbManager = require('./lib/DynamoDbManager');
var LambdaManager = require('./lib/LambdaManager');
var ApiConfiguration = require('./lib/ApiConfiguration');

function AwsArchitect(packageMetadata, apiOptions, contentOptions) {
	this.PackageMetadata = packageMetadata;
	this.ContentDirectory = contentOptions.contentDirectory;
	this.SourceDirectory = apiOptions.sourceDirectory;
	this.Api = require(path.join(apiOptions.sourceDirectory, 'index'));
	this.Configuration = new ApiConfiguration(apiOptions, 'index.js');

	this.Region = this.Configuration.Regions[0];

	var apiGatewayFactory = new aws.APIGateway({region: this.Region});
	this.ApiGatewayManager = new ApiGatewayManager(this.PackageMetadata.name, this.PackageMetadata.version, apiGatewayFactory);

	var lambdaFactory = new aws.Lambda({region: this.Region});
	this.LambdaManager = new LambdaManager(this.PackageMetadata.name, lambdaFactory, this.Configuration);

	var dynamoDbFactory = new aws.DynamoDB({region: this.Region});
	this.DynamoDbManager = new DynamoDbManager(this.PackageMetadata.name, dynamoDbFactory);
}

function GetAccountIdPromise() {
	return new aws.IAM().getUser({}).promise().then((data) => data.User.Arn.split(':')[4]);
}

AwsArchitect.prototype.GetApiGatewayPromise = function() {
	return this.ApiGatewayManager.GetApiGatewayPromise();
}
AwsArchitect.prototype.PublishPromise = function() {
	var accountIdPromise = GetAccountIdPromise();

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
		fs.writeFile(path.join(tmpDir, 'package.json'), JSON.stringify(this.PackageMetadata), (error, data) => {
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
		return accountIdPromise.then(accountId => this.LambdaManager.PublishLambdaPromise(accountId, zipInformation.Archive));
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

			var permissionsPromise = accountIdPromise.then(accountId => this.LambdaManager.SetPermissionsPromise(accountId, lambdaArn, apiGatewayId));

			var lambdaArnStagedVersioned = lambdaArn.replace(`:${lambdaVersion}`, ':${stageVariables.lambdaVersion}');
			var lambdaFullArn = `arn:aws:apigateway:${this.Region}:lambda:path/2015-03-31/functions/${lambdaArnStagedVersioned}/invocations`;
			var updateRestApiPromise = this.ApiGatewayManager.PutRestApiPromise(this.Api, lambdaFullArn, apiGatewayId);

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

AwsArchitect.prototype.DeployStagePromise = function(restApiId, stage, lambdaVersion) {
	if(!restApiId) { throw new Error('Rest ApiId is not defined.'); }
	if(!stage) { throw new Error('Deployment stage is not defined.'); }
	if(!lambdaVersion) { throw new Error('Deployment lambdaVersion is not defined.'); }
	return this.ApiGatewayManager.DeployStagePromise(restApiId, stage, lambdaVersion);
};

AwsArchitect.prototype.PublishDatabasePromise = function(stage, databaseSchema) {
	if(!stage) { throw new Error('Deployment stage is not defined.'); }
	return this.DynamoDbManager.PublishDatabasePromise(stage, databaseSchema || []);
};

AwsArchitect.prototype.PublishAndDeployPromise = function(stage, databaseSchema) {
	if(!stage) { throw new Error('Deployment stage is not defined.'); }

	return this.PublishPromise()
	.then(result => {
		var dynamoDbPublishPromise = this.DynamoDbManager.PublishDatabasePromise(stage, databaseSchema || []);
		return dynamoDbPublishPromise.then(database => this.ApiGatewayManager.DeployStagePromise(result.RestApiId, stage, result.LambdaVersion));
	})
	.catch(failure => {
		return Promise.reject({Error: 'Failed to create and deploy updates.', Details: failure});
	});
};

AwsArchitect.prototype.Run = function() {
	try {
		new Server(this.ContentDirectory, this.Api).Run();
		return Promise.resolve({Message: 'Server started successfully'});
	}
	catch (exception) {
		return Promise.reject({Error: 'Failed to start server', Exception: exception.stack || exception});
	}
};


module.exports = AwsArchitect;