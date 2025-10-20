let archiver = require('archiver');
let aws = require('aws-sdk');
let exec = require('child_process').exec;
let fs = require('fs-extra');
let path = require('path');
let os = require('os');
const shortUuid = require('short-uuid');

let Server = require('./lib/server');
let ApiGatewayManager = require('./lib/ApiGatewayManager');
let LambdaManager = require('./lib/LambdaManager');
let ApiConfiguration = require('./lib/ApiConfiguration');
let BucketManager = require('./lib/BucketManager');
let CloudFormationDeployer = require('./lib/CloudFormationDeployer');
let LockFinder = require('./lib/lockFinder');

async function GetAccountIdPromise() {
  const callerData = await new aws.STS().getCallerIdentity().promise();
  return callerData.Account;
}

function getStageName(stage) {
  return stage.replace(/[^a-zA-Z0-9-]/g, '-');
}

class AwsArchitect {
  constructor(packageMetadata, apiOptions, contentOptions) {
    this.PackageMetadata = packageMetadata || {};
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
    this.CloudFormationDeployer = new CloudFormationDeployer(this.Region, this.BucketManager, this.deploymentBucket);
  }

  async publishZipArchive(options = {}) {
    if (!options.zipFileName || !this.deploymentBucket || !options.sourceDirectory) {
      throw Error('The zipFileName, sourceDirectory, api options deploymentBucket must be specified.');
    }
    let tmpDir = path.join(os.tmpdir(), `zipDirectory-${shortUuid.generate()}`);
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
  }

  async publishLambdaArtifactPromise(options = {}) {
    let lambdaZip = options && options.zipFileName || 'lambda.zip';
    let tmpDir = path.join(os.tmpdir(), `lambda-${shortUuid.generate()}`);

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
      const lockFile = await new LockFinder().findLockFile(this.SourceDirectory);
      if (lockFile.file) {
        await fs.copy(lockFile.file, path.join(tmpDir, path.basename(lockFile.file)));
      }

      try {
        await fs.writeJson(path.join(tmpDir, 'package.json'), this.PackageMetadata);
      } catch (error) {
        throw { Error: 'Failed writing production package.json file.', Details: error };
      }

      let cmd = lockFile.command;
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
  }

  async validateTemplate(stackTemplate, stackConfiguration) {
    const result = await this.CloudFormationDeployer.validateTemplate(stackTemplate, stackConfiguration && stackConfiguration.stackName, `${this.PackageMetadata.name}/${this.PackageMetadata.version}`);
    return result;
  }

  async deployTemplate(stackTemplate, stackConfiguration, parameters) {
    const result = await this.CloudFormationDeployer.deployTemplate(stackTemplate, stackConfiguration, parameters, `${this.PackageMetadata.name}/${this.PackageMetadata.version}`);
    return result;
  }

  async deployStackSetTemplate(stackTemplate, stackConfiguration, parameters) {
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
  }

  async configureStackSetForAwsOrganization(stackTemplate, stackConfiguration, parameters) {
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

    return this.CloudFormationDeployer.configureStackSetForAwsOrganization(stackTemplate, stackConfiguration, parameters);
  }

  async deployStagePromise(stage, lambdaVersion) {
    if (!stage) { throw new Error('Deployment stage is not defined.'); }
    if (!lambdaVersion) { throw new Error('Deployment lambdaVersion is not defined.'); }
    const restApi = await this.ApiGatewayManager.GetApiGatewayPromise();
    const result = await this.ApiGatewayManager.DeployStagePromise(restApi, stage, lambdaVersion);
    return result;
  }

  async removeStagePromise(stage, functionName) {
    if (!stage) { throw new Error('Deployment stage is not defined.'); }
    let stageName = getStageName(stage);
    const apiGateway = await this.ApiGatewayManager.GetApiGatewayPromise();
    const result = await this.ApiGatewayManager.RemoveStagePromise(apiGateway, stageName);
    if (functionName) {
      await this.LambdaManager.removeVersion(functionName, stageName);
    }
    return { title: 'Successfully deleted stage', stage: stageName, details: result };
  }

  async deployLambdaFunctionVersion(options = {}) {
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

      return {
        LambdaResult: {
          LambdaFunctionArn: lambdaArn,
          LambdaVersion: lambdaVersion
        }
      };
    } catch (failure) {
      throw { Error: 'Failed to create and deploy updates.', Details: failure };
    }
  }

  async publishAndDeployStagePromise(options = {}) {
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
      throw { Error: 'Failed to create and deploy updates.', request: options, Details: failure };
    }
  }

  async cleanupPreviousFunctionVersions(functionName, forceRemovalOfAliases) {
    await this.LambdaManager.cleanupProduction(functionName, forceRemovalOfAliases, false);
  }

  async publishWebsite(version, options = {}) {
    if (!this.BucketManager.Bucket) { throw new Error('Bucket in content options has not been defined.'); }
    if (!this.ContentOptions.contentDirectory) { throw new Error('Content directory is not defined.'); }

    const result = await this.BucketManager.Deploy(this.ContentOptions.contentDirectory, version, options.cacheControlRegexMap || [], options.contentTypeMappingOverride);
    return result;
  }

  async deleteWebsiteVersion(version) {
    if (!this.BucketManager.Bucket) { throw new Error('Bucket in content options has not been defined.'); }
    if (!version) { throw new Error('Website version is required.'); }

    const result = await this.BucketManager.deletePath(version);
    return result;
  }

  async run(port, logger) {
    try {
      let indexPath = path.join(this.SourceDirectory, 'index.js');
      let api = require(indexPath);
      let server = new Server(this.ContentOptions.contentDirectory, api.default || api, logger);
      let attemptPort = port || 8080;
      let resolvedPort = await server.Run(attemptPort);
      if (resolvedPort !== attemptPort) {
        console.log('Requested Port is in use. Using the next available port.');
      }
      return Promise.resolve({ title: `Server started successfully at 'http://localhost:${resolvedPort}', lambda routes available at /api, /triggers/event, /triggers/schedule.`, server });
    } catch (exception) {
      return Promise.reject({ title: 'Failed to start server', error: exception.stack || exception });
    }
  }
}

module.exports = AwsArchitect;
