/*
	Automatically configure microservice in AWS
	Copyright (C) 2018 Warren Parad
	
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

let archiver = require('archiver');
let aws = require('aws-sdk');
let exec = require('child_process').exec;
let fs = require('fs-extra');
let path = require('path');
let os = require('os');
let uuid = require('uuid');
let http = require('http');

let Server = require('./lib/server');
let ApiGatewayManager = require('./lib/ApiGatewayManager');
let LambdaManager = require('./lib/LambdaManager');
let ApiConfiguration = require('./lib/ApiConfiguration');
let BucketManager = require('./lib/BucketManager');
let CloudFormationDeployer = require('./lib/CloudFormationDeployer');
let LockFinder = require('./lib/lockFinder');

function AwsArchitect(packageMetadata, apiOptions, contentOptions) {
	this.PackageMetadata = packageMetadata;
	this.ContentOptions = contentOptions || {};
	this.SourceDirectory = (apiOptions || {}).sourceDirectory;

	if (!aws.config.region && apiOptions.regions && apiOptions.regions[0]) {
		aws.config.update({ region: apiOptions.regions[0] });
	}
	this.Configuration = new ApiConfiguration(apiOptions, 'index.js', aws.config.region || 'us-east-1');

	if (this.Configuration.Regions.length === 0) { throw new Error('A single region must be defined in the apiOptions.'); }
	if (this.Configuration.Regions.length > 1) { throw new Error('Only deployments to a single region are allowed at this time.'); }
	this.Region = this.Configuration.Regions[0];

	let apiGatewayFactory = new aws.APIGateway({ region: this.Region });
	this.ApiGatewayManager = new ApiGatewayManager(this.PackageMetadata.name, this.PackageMetadata.version, apiGatewayFactory);

	let lambdaFactory = new aws.Lambda({ region: this.Region });
	this.LambdaManager = new LambdaManager(this.PackageMetadata.name, lambdaFactory);

	let s3Factory = new aws.S3({ region: this.Region });
	this.BucketManager = new BucketManager(s3Factory, this.ContentOptions.bucket);

	let cloudFormationClient = new aws.CloudFormation({ region: this.Region });
	this.CloudFormationDeployer = new CloudFormationDeployer(cloudFormationClient);
}

function GetAccountIdPromise() {
	return new aws.IAM().getUser({}).promise()
	.then(data => data.User.Arn.split(':')[4])
	.catch(() => {
		//assume EC2 instance profile
		return new Promise((resolve, reject) => {
			http.get('http://169.254.169.254/latest/dynamic/instance-identity/document', res => {
				if (res.statusCode >= 400) { return Promise.reject('Failed to lookup AWS AccountID, please specify by running as IAM user or with credentials.'); }
				let data = '';
				res.on('data', chunk => {
					data += chunk;
				});
				res.on('end', () => {
					try {
						let json = JSON.parse(data);
						resolve(json.accountId);
					} catch (exception) {
						reject(JSON.stringify({ Title: 'Failure trying to parse AWS AccountID from metadata', Error: exception.stack || exception.toString(), Details: exception, Response: data }));
					}
				});
				res.on('error', error => reject(error));
				return null;
			});
		});
	});
}

AwsArchitect.prototype.publishLambdaArtifactPromise = AwsArchitect.prototype.PublishLambdaArtifactPromise = function(options = {}) {
	let lambdaZip = 'lambda.zip';
	let tmpDir = path.join(os.tmpdir(), `lambda-${uuid.v4()}`);
	let zipArchiveInformationPromise = new Promise((resolve, reject) => {
		fs.stat(this.SourceDirectory, (error, stats) => {
			if (error) { return reject({ Error: `Path does not exist: ${this.SourceDirectory} - ${error}` }); }
			if (!stats.isDirectory) { return reject({ Error: `Path is not a directory: ${this.SourceDirectory}` }); }
			return resolve(null);
		});
	})
	.then(() => {
		return fs.copy(this.SourceDirectory, tmpDir);
	})
	.then(() => {
		return new LockFinder().findLockFile(this.SourceDirectory)
		.then(lockFile => {
			return lockFile ? fs.copy(lockFile.file, path.join(tmpDir, path.basename(lockFile.file))) : Promise.resolve();
		});
	})
	.then(() => {
		return fs.writeJson(path.join(tmpDir, 'package.json'), this.PackageMetadata)
		.catch(error => ({ Error: 'Failed writing production package.json file.', Details: error }));
	})
	.then(() => {
		return fs.pathExists(path.join(tmpDir, 'yarn.lock')).catch(() => false)
		.then(exists => {
			let cmd = exists ? 'yarn --prod --frozen-lockfile' : 'npm install --production';
			return new Promise((resolve, reject) => {
				/* eslint-disable-next-line no-unused-vars */
				exec(cmd, { cwd: tmpDir }, (error, stdout, stderr) => {
					if (error) { return reject({ Error: 'Failed installing production npm modules.', Details: error }); }
					return resolve(tmpDir);
				});
			});
		});
	})
	.then(() => new Promise((resolve, reject) => {
		let zipArchivePath = path.join(tmpDir, lambdaZip);
		let zipStream = fs.createWriteStream(zipArchivePath);
		zipStream.on('close', () => resolve({ Archive: zipArchivePath }));

		let archive = archiver.create('zip', {});
		archive.on('error', e => reject({ Error: e }));
		archive.pipe(zipStream);
		archive.glob('**', { dot: true, cwd: tmpDir, ignore: lambdaZip });
		archive.finalize();
	}));

	return zipArchiveInformationPromise
	.then(zipInformation => {
		if (options.bucket) {
			return this.BucketManager.DeployLambdaPromise(options.bucket, zipInformation.Archive, `${this.PackageMetadata.name}/${this.PackageMetadata.version}/${lambdaZip}`);
		}
		return Promise.resolve();
	}).then(() => zipArchiveInformationPromise);
};

AwsArchitect.prototype.validateTemplate = AwsArchitect.prototype.ValidateTemplate = function(stackTemplate) {
	return this.CloudFormationDeployer.validateTemplate(stackTemplate);
};

AwsArchitect.prototype.deployTemplate = AwsArchitect.prototype.DeployTemplate = function(stackTemplate, stackConfiguration, parameters) {
	return this.CloudFormationDeployer.deployTemplate(stackTemplate, stackConfiguration, parameters);
};

AwsArchitect.prototype.deployStagePromise = AwsArchitect.prototype.DeployStagePromise = function(stage, lambdaVersion) {
	if (!stage) { throw new Error('Deployment stage is not defined.'); }
	if (!lambdaVersion) { throw new Error('Deployment lambdaVersion is not defined.'); }
	return this.ApiGatewayManager.GetApiGatewayPromise()
	.then(result => result.Id)
	.then(restApiId => this.ApiGatewayManager.DeployStagePromise(restApiId, stage, lambdaVersion));
};

function getStageName(stage) {
	return stage.replace(/[^a-zA-Z0-9-]/g, '-');
}

AwsArchitect.prototype.removeStagePromise = AwsArchitect.prototype.RemoveStagePromise = function(stage) {
	if (!stage) { throw new Error('Deployment stage is not defined.'); }
	let stageName = getStageName(stage);
	let apiGatewayPromise = this.ApiGatewayManager.GetApiGatewayPromise();
	return apiGatewayPromise
	.then(result => this.ApiGatewayManager.RemoveStagePromise(result.Id, stageName))
	.then(result => ({
		title: 'Successfully delete stage',
		stage: stageName,
		details: result
	}));
};

AwsArchitect.prototype.publishAndDeployStagePromise = AwsArchitect.prototype.PublishAndDeployStagePromise = async function(options = {}) {
	let stage = options.stage;
	let stageName = getStageName(stage);
	let functionName = options.functionName;
	let bucket = options.deploymentBucketName;
	let deploymentKey = options.deploymentKeyName;
	if (!stage) { throw new Error('Deployment stage is not defined.'); }
	
	let apiGateway = await this.ApiGatewayManager.GetApiGatewayPromise();
	let apiGatewayId = apiGateway.Id;

	let accountId = await GetAccountIdPromise();
	return this.LambdaManager.PublishNewVersion(functionName, bucket, deploymentKey)
	.then(async lambda => {
		let lambdaArn = lambda.FunctionArn;
		let lambdaVersion = lambda.Version;

		await this.LambdaManager.SetAlias(functionName, stageName, lambdaVersion);
		await this.LambdaManager.SetPermissionsPromise(accountId, lambdaArn, apiGatewayId, this.Region, stageName);
		return {
			LambdaFunctionArn: lambdaArn,
			LambdaVersion: lambdaVersion,
			RestApiId: apiGatewayId
		};
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
		return Promise.reject({ Error: 'Failed to create and deploy updates.', Details: failure });
	});
};

AwsArchitect.prototype.publishWebsite = AwsArchitect.prototype.PublishWebsite = function(version, options = {}) {
	if (!this.BucketManager.Bucket) { throw new Error('Bucket in cotent options has not been defined.'); }
	if (!this.ContentOptions.contentDirectory) { throw new Error('Content directory is not defined.'); }
	if (!version) { throw new Error('Deployment version is not defined.'); }

	return this.BucketManager.Deploy(this.ContentOptions.contentDirectory, version, options.cacheControlRegexMap, options.contentTypeMappingOverride);
};

AwsArchitect.prototype.run = AwsArchitect.prototype.Run = async function(port, logger) {
	try {
		let indexPath = path.join(this.SourceDirectory, 'index.js');
		let api = require(indexPath);
		let server = new Server(this.ContentOptions.contentDirectory, api, logger);
		let attemptPort = port || 8080;
		let resolvedPort = await server.Run(attemptPort);
		if (resolvedPort !== attemptPort) {
			console.log('Requested Port is in use. Using the next available port.');
		}
		return Promise.resolve({ title: `Server started successfully at 'http://localhost:${resolvedPort}', lambda routes available at /api, /triggers/event, /triggers/schedule.` });
	} catch (exception) {
		return Promise.reject({ title: 'Failed to start server', error: exception.stack || exception });
	}
};

module.exports = AwsArchitect;
