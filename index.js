'use strict';

var archiver = require('archiver');
var aws = require('aws-sdk');
var fs = require('fs');
var path = require('path');
var os = require('os');
var uuid = require('uuid');

var Server = require('./lib/server');
var aws = require('aws-sdk');

function AwsArchitect(serviceConfig, serviceName, contentDirectory, sourceDirectory) {
	this.Config = serviceConfig;
	this.ServiceName = serviceName;
	this.ContentDirectory = contentDirectory;
	this.SourceDirectory = sourceDirectory;
}

function GetAccountIdPromise() {
	return new aws.IAM().getUser({}).promise().then((data) => data.User.Arn.split(':')[4]);
}

AwsArchitect.prototype.PublishPromise = function() {
	var apigateway = new aws.APIGateway({region: this.Config.awsConfig.regions[0]});
	var apiGatewayCreatePromise = apigateway.getRestApis({ limit: 500 }).promise()
	.then((apis) => {
		var serviceApi = apis.items.find((api) => api.name === this.ServiceName);
		if(!serviceApi) {
			return apigateway.createRestApi({ name: this.ServiceName }).promise()
			.then((data) => {
				return { Id: data.id, Name: data.name };
			}, (error) => {
				return Promise.reject({Error: 'Failed to create API Gateway', Detail: error.stack || error});
			});
		}
		return { Id: serviceApi.id, Name: serviceApi.name };
	});

	var tmpDir = path.join(os.tmpdir(), `lambda-${uuid.v4()}`);
	var lambdaPromise = new Promise((s, f) => { fs.mkdir(tmpDir, (error) => { return error ? f({Error: `Could not make temporary director: ${error}`}) : s(null); }); })
	//call npm install --production in the temporary directory after copying in the package.json file
	.then(() => {
		var zipArchivePath = path.join(tmpDir, 'lambda.zip');
		return new Promise((s, f) => {
			fs.stat(this.SourceDirectory, (error, stats) => {
				if(error) { return f({Error: `Path does not exist: ${this.SourceDirectory} - ${error}`}); }
				if(!stats.isDirectory) { return f({Error: `Path is not a directory: ${this.SourceDirectory}`}); }

				var zipStream = fs.createWriteStream(zipArchivePath);
				zipStream.on('close', () => s({Archive: zipArchivePath}));

				var archive = archiver.create('zip', {});
				archive.on('error', (e) => f({Error: e}));
				archive.pipe(zipStream);
				archive.bulk([
				{
					expand: true,
					src: ['**/*.*'],
					dot: true,
					cwd: this.SourceDirectory
				}]);
				archive.finalize();
			});
		});
	}).then((zipInformation) => {
		var awsLambdaPublisher = new aws.Lambda({region: this.Config.awsConfig.regions[0]});
		var lambdaName = 'index';
		var functionName = `${this.ServiceName}-${lambdaName}`;

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
					Code: { ZipFile:  fs.readFileSync(zipInformation.Archive) },
					Handler: `${lambdaName}.handler`,
					Role: `arn:aws:iam::${accountId}:role/${this.Config.awsConfig.role}`,
					Runtime: 'nodejs4.3',
					Description: functionName,
					MemorySize: 128,
					Publish: true,
					Timeout: 3
				}).promise()
			});
		})
		.catch((error) => {
			return Promise.reject({Error: error, Detail: error.stack});
		});
	})
	.then((responses) => {
		return {Title: 'Uploaded Lambdas', Result: responses};
	});

	return Promise.all([lambdaPromise, apiGatewayCreatePromise]);
};

AwsArchitect.prototype.Run = function(mainIndexFile) {
	try {
		new Server(this.ContentDirectory, mainIndexFile || path.join(this.SourceDirectory, 'index.js'), this.Config).Run();
		return Promise.resolve({Message: 'Server started successfully'});
	}
	catch (exception) {
		return Promise.reject({Error: 'Failed to start server', Exception: exception});
	}
};


module.exports = AwsArchitect;