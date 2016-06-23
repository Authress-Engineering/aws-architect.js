'use strict';

var archiver = require('archiver');
var aws = require('aws-sdk');
var exec = require('child_process').exec;
var fs = require('fs-extra');
var path = require('path');
var os = require('os');
var uuid = require('uuid');

var Server = require('./lib/server');
var aws = require('aws-sdk');

function AwsArchitect(contentDirectory, sourceDirectory) {
	this.ContentDirectory = contentDirectory;
	this.SourceDirectory = sourceDirectory;
	this.Api = require(path.join(sourceDirectory, 'index'));
}

function GetAccountIdPromise() {
	return new aws.IAM().getUser({}).promise().then((data) => data.User.Arn.split(':')[4]);
}

AwsArchitect.prototype.PublishPromise = function() {
	var region = this.Api.Configuration.Regions[0];
	//TODO: Assume that the src directory is one level down from root, figure out how to find this automatically by the current location.
	var packageMetadataFile = path.join(path.dirname(this.SourceDirectory), 'package.json');
	var packageMetaData = require(packageMetadataFile);
	var serviceName = packageMetaData.name;
	var apigateway = new aws.APIGateway({region: region});
	var apiGatewayCreatePromise = apigateway.getRestApis({ limit: 500 }).promise()
	.then((apis) => {
		var serviceApi = apis.items.find((api) => api.name === serviceName);
		if(!serviceApi) {
			return apigateway.createRestApi({ name: serviceName }).promise()
			.then((data) => {
				return { Id: data.id, Name: data.name };
			}, (error) => {
				return Promise.reject({Error: 'Failed to create API Gateway', Detail: error.stack || error});
			});
		}
		return { Id: serviceApi.id, Name: serviceApi.name };
	});

	return Promise.resolve(null)
	.then(() => new Promise((s, f) => {
		fs.stat(this.SourceDirectory, (error, stats) => {
			if(error) { return f({Error: `Path does not exist: ${this.SourceDirectory} - ${error}`}); }
			if(!stats.isDirectory) { return f({Error: `Path is not a directory: ${this.SourceDirectory}`}); }
			return s(null);
		});
	}))
	.then(() => new Promise((s, f) => {
		var tmpDir = path.join(os.tmpdir(), `lambda-${uuid.v4()}`);
		fs.copy(this.SourceDirectory, tmpDir, error => {
			return error ? f(error) : s(tmpDir);
		});
	}))
	.then((tmpDir) => new Promise((s, f) => {
		fs.writeFile(path.join(tmpDir, 'package.json'), JSON.stringify(packageMetaData), (error, data) => {
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
					Code: { ZipFile:  fs.readFileSync(zipInformation.Archive) },
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
	})
	.then((responses) => {
		return {Title: 'Uploaded Lambdas', Result: responses};
	});

	return Promise.all([lambdaPromise, apiGatewayCreatePromise]);
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