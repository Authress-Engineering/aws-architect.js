/*
	Automatically configure microservice in AWS
	Copyright (C) 2018 Warren Parad

	This program is free software: you can redistribute it and/or modify
	it under the terms of the GNU General Public License as published by
	the Free Software Foundation, either version 3 of the License, or
	(at your option) any later version.

	This program is distributed in the hope that it will be useful,
	but WITHOUT ANY WARRANTY; without even the implied warranty of
	MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.	See the
	GNU General Public License for more details.

	You should have received a copy of the GNU General Public License
	along with this program.	If not, see <https://www.gnu.org/licenses/>.
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
  this.deploymentBucket = (apiOptions || {}).deploymentBucket;
  this.SourceDirectory = (apiOptions || {}).sourceDirectory;

  if (!aws.config.region && apiOptions.regions && apiOptions.regions[0]) {
    aws.config.update({ region: apiOptions.regions[0] });
  }
  this.Configuration = new ApiConfiguration(apiOptions, 'index.js', aws.config.region || 'us-east-1');

  if (this.Configuration.Regions.length === 0) { throw new Error('A single region must be defined in the apiOptions.'); }
  if (this.Configuration.Regions.length > 1) { throw new Error('Only deployments to a single region are allowed at this time.'); }
  this.Region = this.Configuration.Regions[0];

  this.ApiGatewayManager = new ApiGatewayManager(this.PackageMetadata.name, this.PackageMetadata.version, this.Region);

  this.LambdaManager = new LambdaManager(this.Region);

  let s3Factory = new aws.S3({ region: this.Region });
  this.BucketManager = new BucketManager(s3Factory, this.ContentOptions.bucket);

  let cloudFormationClient = new aws.CloudFormation({ region: this.Region });
  this.CloudFormationDeployer = new CloudFormationDeployer(cloudFormationClient, this.BucketManager, this.deploymentBucket);
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

AwsArchitect.prototype.publishZipArchive = async function(options = {}) {
  if (!options.zipFileName || !this.deploymentBucket || !options.sourceDirectory) {
    throw Error('The zipFileName, sourceDirectory, api options deploymentBucket must be specified.');
  }
  let tmpDir = path.join(os.tmpdir(), `zipDirectory-${uuid.v4()}`);
  await new Promise((resolve, reject) => { fs.stat(options.sourceDirectory, (error, stats) => error || !stats.isDirectory ? reject(error || 'NotDirectoryError') : resolve()); });
  await fs.copy(options.sourceDirectory, tmpDir);
  let zipArchivePath = path.join(tmpDir, options.zipFileName);
  await new Promise((resolve, reject) => {
    let zipStream = fs.createWriteStream(zipArchivePath);
    zipStream.on('close', () => resolve());

    let archive = archiver.create('zip', {});
    archive.on('error', e => reject({ Error: e }));
    archive.pipe(zipStream);
    archive.glob('**', { dot: true, cwd: tmpDir, ignore: options.zipFileName });
    archive.finalize();
  });

  await this.BucketManager.DeployLambdaPromise(this.deploymentBucket, zipArchivePath, `${this.PackageMetadata.name}/${this.PackageMetadata.version}/${options.zipFileName}`);
};

AwsArchitect.prototype.publishLambdaArtifactPromise = AwsArchitect.prototype.PublishLambdaArtifactPromise = async function(options = {}) {
  let lambdaZip = options && options.zipFileName || 'lambda.zip';
  let tmpDir = path.join(os.tmpdir(), `lambda-${uuid.v4()}`);

  await new Promise((resolve, reject) => {
    fs.stat(this.SourceDirectory, (error, stats) => {
      if (error) { return reject({ Error: `Path does not exist: ${this.SourceDirectory} - ${error}` }); }
      if (!stats.isDirectory) { return reject({ Error: `Path is not a directory: ${this.SourceDirectory}` }); }
      return resolve(null);
    });
  });

  await fs.copy(this.SourceDirectory, tmpDir);

  // (default: true) If set to true, will attempt to copy and install packages related to deployment (i.e. package.json for node)
  if (options.autoHandleCompileOfSourceDirectory !== false) {
    await new LockFinder().findLockFile(this.SourceDirectory).then(lockFile => {
      return lockFile ? fs.copy(lockFile.file, path.join(tmpDir, path.basename(lockFile.file))) : Promise.resolve();
    });

    try {
      await fs.writeJson(path.join(tmpDir, 'package.json'), this.PackageMetadata);
    } catch (error) {
      throw { Error: 'Failed writing production package.json file.', Details: error };
    }

    const exists = await fs.pathExists(path.join(tmpDir, 'yarn.lock')).catch(() => false);
    let cmd = exists ? 'yarn --prod --frozen-lockfile' : 'npm install --production';
    await new Promise((resolve, reject) => {
      /* eslint-disable-next-line no-unused-vars */
      exec(cmd, { cwd: tmpDir }, (error, stdout, stderr) => {
        if (error) { return reject({ Error: 'Failed installing production npm modules.', Details: error }); }
        return resolve(tmpDir);
      });
    });
  }

  let zipArchivePath = path.join(tmpDir, lambdaZip);
  await new Promise((resolve, reject) => {
    let zipStream = fs.createWriteStream(zipArchivePath);
    zipStream.on('close', () => resolve({ Archive: zipArchivePath }));

    let archive = archiver.create('zip', {});
    archive.on('error', e => reject({ Error: e }));
    archive.pipe(zipStream);
    archive.glob('**', { dot: true, cwd: tmpDir, ignore: lambdaZip });
    archive.finalize();
  });

  let bucket = options && options.bucket || this.deploymentBucket;
  if (bucket) {
    await this.BucketManager.DeployLambdaPromise(bucket, zipArchivePath, `${this.PackageMetadata.name}/${this.PackageMetadata.version}/${lambdaZip}`);
  }
};

AwsArchitect.prototype.validateTemplate = AwsArchitect.prototype.ValidateTemplate = function(stackTemplate, stackConfiguration) {
  return this.CloudFormationDeployer.validateTemplate(stackTemplate, stackConfiguration && stackConfiguration.stackName, `${this.PackageMetadata.name}/${this.PackageMetadata.version}`);
};

AwsArchitect.prototype.deployTemplate = AwsArchitect.prototype.DeployTemplate = function(stackTemplate, stackConfiguration, parameters) {
  return this.CloudFormationDeployer.deployTemplate(stackTemplate, stackConfiguration, parameters, `${this.PackageMetadata.name}/${this.PackageMetadata.version}`);
};

AwsArchitect.prototype.deployStackSetTemplate = async function(stackTemplate, stackConfiguration, parameters) {
  try {
    await new aws.IAM().getRole({ RoleName: 'AWSCloudFormationStackSetExecutionRole' }).promise();
  } catch (error) {
    if (error.code === 'NoSuchEntity') {
      throw { title: 'Role "AWSCloudFormationStackSetExecutionRole" must exist. See prerequisite for cloudformation: https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/stacksets-prereqs-self-managed.html' };
    }
    throw error;
  }

  try {
    await new aws.IAM().getRole({ RoleName: 'AWSCloudFormationStackSetAdministrationRole' }).promise();
  } catch (error) {
    if (error.code === 'NoSuchEntity') {
      throw { title: 'Role "AWSCloudFormationStackSetAdministrationRole" must exist. See prerequisite for cloudformation: https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/stacksets-prereqs-self-managed.html' };
    }
    throw error;
  }

  let accountId = await GetAccountIdPromise();
  return this.CloudFormationDeployer.deployStackSetTemplate(accountId, stackTemplate, stackConfiguration, parameters, `${this.PackageMetadata.name}/${this.PackageMetadata.version}`);
};

AwsArchitect.prototype.deployStagePromise = AwsArchitect.prototype.DeployStagePromise = function(stage, lambdaVersion) {
  if (!stage) { throw new Error('Deployment stage is not defined.'); }
  if (!lambdaVersion) { throw new Error('Deployment lambdaVersion is not defined.'); }
  return this.ApiGatewayManager.GetApiGatewayPromise()
  .then(restApi => this.ApiGatewayManager.DeployStagePromise(restApi, stage, lambdaVersion));
};

function getStageName(stage) {
  return stage.replace(/[^a-zA-Z0-9-]/g, '-');
}

AwsArchitect.prototype.removeStagePromise = AwsArchitect.prototype.RemoveStagePromise = async function(stage, functionName) {
  if (!stage) { throw new Error('Deployment stage is not defined.'); }
  let stageName = getStageName(stage);
  const apiGateway = await this.ApiGatewayManager.GetApiGatewayPromise();
  const result = await this.ApiGatewayManager.RemoveStagePromise(apiGateway, stageName);
  if (functionName) {
    await this.LambdaManager.removeVersion(functionName, stageName);
  }
  return { title: 'Successfully deleted stage', stage: stageName, details: result };
};

AwsArchitect.prototype.publishAndDeployStagePromise = AwsArchitect.prototype.PublishAndDeployStagePromise = async function(options = {}) {
  let stage = options.stage;
  let stageName = getStageName(stage);
  let functionName = options.functionName;
  let bucket = options.deploymentBucketName || this.deploymentBucket;
  let deploymentKey = options.deploymentKeyName;
  if (!stage) { throw new Error('Deployment stage is not defined.'); }

  try {
    const lambda = await this.LambdaManager.PublishNewVersion(functionName, bucket, deploymentKey);
    const lambdaArn = lambda.FunctionArn;
    const lambdaVersion = lambda.Version;
    await this.LambdaManager.SetAlias(functionName, stageName, lambdaVersion);

    let apiGateway;
    try {
      apiGateway = await this.ApiGatewayManager.GetApiGatewayPromise();
    } catch (error) {
      if (error.code === 'ApiGatewayServiceNotFound') {
        return {
          LambdaResult: {
            LambdaFunctionArn: lambdaArn,
            LambdaVersion: lambdaVersion
          }
        };
      }
      throw error;
    }

    let accountId = await GetAccountIdPromise();
    await this.LambdaManager.SetPermissionsPromise(accountId, lambdaArn, apiGateway.Id, this.Region, stageName);
    const data = await this.ApiGatewayManager.DeployStagePromise(apiGateway, stageName, stage, lambdaVersion);
    return {
      LambdaResult: {
        LambdaFunctionArn: lambdaArn,
        LambdaVersion: lambdaVersion
      },
      ApiGatewayResult: data,
      ServiceApi: `https://${apiGateway.Id}.execute-api.${this.Region}.amazonaws.com/${stageName}`
    };
  } catch (failure) {
    throw { Error: 'Failed to create and deploy updates.', Details: failure };
  }
};

AwsArchitect.prototype.cleanupPreviousFunctionVersions = async function(functionName, forceRemovalOfAliases) {
  await this.LambdaManager.cleanupProduction(functionName, forceRemovalOfAliases, false);
};

AwsArchitect.prototype.publishWebsite = AwsArchitect.prototype.PublishWebsite = function(version, options = {}) {
  if (!this.BucketManager.Bucket) { throw new Error('Bucket in cotent options has not been defined.'); }
  if (!this.ContentOptions.contentDirectory) { throw new Error('Content directory is not defined.'); }
  if (!version) { throw new Error('Deployment version is not defined.'); }

  return this.BucketManager.Deploy(this.ContentOptions.contentDirectory, version, options.cacheControlRegexMap || [], options.contentTypeMappingOverride, options.enableIndexConversion);
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
    return Promise.resolve({ title: `Server started successfully at 'http://localhost:${resolvedPort}', lambda routes available at /api, /triggers/event, /triggers/schedule.`, server });
  } catch (exception) {
    return Promise.reject({ title: 'Failed to start server', error: exception.stack || exception });
  }
};

module.exports = AwsArchitect;
