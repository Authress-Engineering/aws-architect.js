'use strict';

var archiver = require('archiver');
var aws = require('aws-sdk');
var fs = require('fs');
var path = require('path');
var os = require('os');

var Server = require('./lib/server');var aws = require('aws-sdk');

function AwsArchitect(awsConfig, serviceName, rootDirectory) {
	aws.config = awsConfig;
	this.RootDirectory = path.resolve(rootDirectory || '.');
	this.ServiceName = serviceName || require(path.join(this.RootDirectory, 'package.json')).name;
	this.Config = require(path.join(this.RootDirectory, 'aws-config.json'));
}

AwsArchitect.prototype.PublishPromise = function() {
	var lambdaPath = 'lambda';
	return new Promise((s, f) => {
		var zipArchivePath = path.join(os.tmpdir(), 'lambda.zip');
		fs.stat(this.RootDirectory, (error, stats) => {
			if(error) { return f({Error: `Path does not exist: ${this.RootDirectory} - ${error}`}); }
			if(!stats.isDirectory) { return f({Error: `Path is not a directory: ${this.RootDirectory}`}); }

			var zipStream = fs.createWriteStream(zipArchivePath);
			zipStream.on('close', () => s({Archive: zipArchivePath}));

			var archive = archiver.create('zip', {});
			archive.on('error', (e) => f({Error: e}));
			archive.pipe(zipStream);
			archive.bulk([{
				expand: true,
				src: [path.join('node_modules', '**/*.*')],
				dot: true,
				cwd: this.RootDirectory
			},
			{
				expand: true,
				src: ['**/*.*'],
				dot: true,
				cwd: path.join(this.RootDirectory, lambdaPath)
			}]);
			archive.finalize();
		});
	}).then((zipInformation) => {
		var awsLambdaPublisher = new aws.Lambda({region: this.Config.awsConfig.regions[0]});
		return Promise.all(this.Config.lambdas.map((lambda) => {
			var lambdaName = path.basename(lambda.filename, '.js');
			var lambdaRole = `arn:aws:iam::${this.Config.awsConfig.accountId}:role/${this.Config.awsConfig.role}`;
			var functionName = `${this.ServiceName}-${lambdaName}`;

			return awsLambdaPublisher.listVersionsByFunction({ FunctionName: functionName, MaxItems: 1 }).promise().then((data) => {
				return awsLambdaPublisher.updateFunctionCode({
					FunctionName: functionName,
					Publish: true,
					ZipFile: fs.readFileSync(zipInformation.Archive)
				}).promise();
			}).catch((failure) => {
				return awsLambdaPublisher.createFunction({
					FunctionName: functionName,
					Code: { ZipFile:  fs.readFileSync(zipInformation.Archive) },
					Handler: `${lambdaName}.handler`,
					Role: lambdaRole,
					Runtime: 'nodejs4.3',
					Description: functionName,
					MemorySize: 128,
					Publish: true,
					Timeout: 3
				}).promise();
			})
			.catch((error) => {
				return Promise.reject({Error: error, Detail: error.stack});
			});
		}))
		.then((responses) => {
			return {Title: 'Uploaded Lambdas', Result: responses};
		});
	});
};

AwsArchitect.prototype.Run = function() {
		try {
			var contentDirectory = path.join(this.RootDirectory, 'content');
			var lambdaDirectory = path.join(this.RootDirectory, 'lambda');
			new Server(contentDirectory, lambdaDirectory, this.Config).Run();
			return Promise.resolve({Message: 'Server started successfully'});
		}
		catch (exception) {
			return Promise.reject({Error: 'Failed to start server', Exception: exception});
		}
};


module.exports = AwsArchitect;