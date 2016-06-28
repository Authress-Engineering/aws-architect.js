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
var ApiConfiguration = require('./lib/ApiConfiguration');

function AwsArchitect(packageMetadata, apiOptions, contentOptions, databaseOptions) {
	this.ContentDirectory = contentOptions.contentDirectory;
	this.SourceDirectory = apiOptions.sourceDirectory;
	this.Api = require(path.join(apiOptions.sourceDirectory, 'index'));
	this.Configuration = new ApiConfiguration(apiOptions, 'index.js');

	//TODO: Assume that the src directory is one level down from root, figure out how to find this automatically by the current location.
	var packageMetadataFile = path.join(path.dirname(this.SourceDirectory), 'package.json');
	this.PackageMetadata = packageMetadata;
}

function GetAccountIdPromise() {
	return new aws.IAM().getUser({}).promise().then((data) => data.User.Arn.split(':')[4]);
}

AwsArchitect.prototype.GetApiGatewayPromise = function() {
	var apiGatewayFactory = new aws.APIGateway({region: region});
	var apiGatewayManager = new ApiGatewayManager(apiGatewayFactory);
	var serviceName = this.PackageMetadata.name;
	return apiGatewayManager.GetApiGatewayPromise(serviceName);
}
AwsArchitect.prototype.PublishPromise = function() {
	var region = this.Configuration.Regions[0];
	var serviceName = this.PackageMetadata.name;
	var awsLambdaFactory = new aws.Lambda({region: region});
	var accountIdPromise = GetAccountIdPromise();

	var configuration = this.Configuration;
	var functionName = `${serviceName}-${configuration.FunctionName}`;

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
		return awsLambdaFactory.listVersionsByFunction({ FunctionName: functionName, MaxItems: 1 }).promise().then(() => {
			return accountIdPromise.then((accountId) => awsLambdaFactory.updateFunctionConfiguration({
				FunctionName: functionName,
				Handler: configuration.Handler,
				Role: `arn:aws:iam::${accountId}:role/${configuration.Role}`,
				Runtime: configuration.Runtime,
				Description: configuration.Description,
				MemorySize: configuration.MemorySize,
				Timeout: configuration.Timeout,
				VpcConfig: {
					SecurityGroupIds: this.Configuration.SecurityGroupIds,
					SubnetIds: this.Configuration.SubnetIds
				}
			}).promise())
			.then(() => awsLambdaFactory.updateFunctionCode({
				FunctionName: functionName,
				Publish: true,
				ZipFile: fs.readFileSync(zipInformation.Archive)
			}).promise());
		}, (failure) => {
			return accountIdPromise.then((accountId) => {
				return awsLambdaFactory.createFunction({
					FunctionName: functionName,
					Code: { ZipFile: fs.readFileSync(zipInformation.Archive) },
					Handler: configuration.Handler,
					Role: `arn:aws:iam::${accountId}:role/${configuration.Role}`,
					Runtime: configuration.Runtime,
					Description: configuration.Description,
					MemorySize: configuration.MemorySize,
					Publish: configuration.Publish,
					Timeout: configuration.Timeout,
					VpcConfig: {
						SecurityGroupIds: this.Configuration.SecurityGroupIds,
						SubnetIds: this.Configuration.SubnetIds
					}
				}).promise()
			});
		})
		.catch((error) => {
			return Promise.reject({Error: error, Detail: error.stack});
		});
	});

	var apiGatewayFactory = new aws.APIGateway({region: region});
	var apiGatewayManager = new ApiGatewayManager(apiGatewayFactory);
	var apiGatewayPromise = apiGatewayManager.GetApiGatewayPromise(serviceName);
	return Promise.all([lambdaPromise, apiGatewayPromise, accountIdPromise])
	.then(result => {
		try {
			var lambda = result[0];
			var lambdaArn = lambda.FunctionArn;
			var lambdaVersion = lambda.Version;
			var apiGateway = result[1];
			var apiGatewayId = apiGateway.Id;
			var accountId = result[2];

			var permissionsPromise = awsLambdaFactory.addPermission({
				Action: 'lambda:InvokeFunction',
				FunctionName: lambdaArn,
				Principal: 'apigateway.amazonaws.com',
				StatementId: uuid.v4().replace('-', ''),
				SourceArn: `arn:aws:execute-api:us-east-1:${accountId}:${apiGatewayId}/*`
			}).promise().then(data => JSON.parse(data.Statement));

			var lambdaArnStagedVersioned = lambdaArn.replace(`:${lambdaVersion}`, ':${stageVariables.lambdaVersion}');
			var lambdaFullArn = `arn:aws:apigateway:${region}:lambda:path/2015-03-31/functions/${lambdaArnStagedVersioned}/invocations`;

			var swaggerBody = apiGatewayManager.GetSwaggerBody(this.Api, this.PackageMetadata.name, this.PackageMetadata.version, lambdaFullArn);
			var updateRestApiPromise = apiGatewayFactory.putRestApi({
				body: JSON.stringify(swaggerBody),
				restApiId: apiGatewayId,
				failOnWarnings: true,
				mode: 'overwrite'
			}).promise();

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
	var region = this.Configuration.Regions[0];
	var apiGatewayFactory = new aws.APIGateway({region: region});
	return new ApiGatewayManager(apiGatewayFactory).DeployStagePromise(restApiId, stage, lambdaVersion);
};

AwsArchitect.prototype.PublishAndDeployPromise = function(stage) {
	if(!stage) { throw new Error('Deployment stage is not defined.'); }
	var region = this.Configuration.Regions[0];
	var apiGatewayFactory = new aws.APIGateway({region: region});
	var apiGatewayManager = new ApiGatewayManager(apiGatewayFactory);
	return this.PublishPromise()
	.then(result => {
		return apiGatewayManager.DeployStagePromise(result.RestApiId, stage, result.LambdaVersion);
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