const { CloudFormation, Organizations, EC2 } = require('aws-sdk');
const Tmp = require('tmp');
Tmp.setGracefulCleanup();
const fs = require('fs-extra');
const isEqual = require('lodash.isequal');

function tryParseJson(stringContent) {
  try {
    return JSON.parse(stringContent);
  } catch (error) {
    return stringContent.trim();
  }
}

class CloudFormationDeployer {
  constructor(region, bucketManager, deploymentBucket) {
    this.cloudFormationClient = new CloudFormation({ region });
    this.bucketManager = bucketManager;
    this.deploymentBucket = deploymentBucket;
  }

  getTemplateBody(template) {
    // If the template is an object, assume the stringified version will result in a valid AWS Template in JSON format.
    if (typeof template === 'object') {
      return JSON.stringify(template);
    }
    return template;
  }

  async validateTemplate(template, stackName, bucketDeploymentKey) {
    let templateString = this.getTemplateBody(template);
    if (stackName && this.deploymentBucket) {
      let templateRelativeUrl = `${bucketDeploymentKey}/${stackName}.cloudformation.template`;
      await new Promise((resolve, reject) => {
        Tmp.file(async (err, path) => {
          if (err) {
            reject(err);
            return;
          }

          try {
            await fs.writeFile(path, templateString, 'utf-8');
            await this.bucketManager.DeployLambdaPromise(this.deploymentBucket, path, templateRelativeUrl);
            resolve();
          } catch (asyncError) {
            reject(asyncError);
          }
        });
      });
      let templateUrl = `https://s3.amazonaws.com/${this.deploymentBucket}/${templateRelativeUrl}`;
      await this.cloudFormationClient.validateTemplate({ TemplateURL: templateUrl }).promise();
    } else {
      await this.cloudFormationClient.validateTemplate({ TemplateBody: templateString }).promise();
    }
  }

  async stackExists(stackName) {
    let data;
    try {
      data = await this.cloudFormationClient.describeStacks({ StackName: stackName }).promise();
    } catch (error) {
      return false;
    }
    if (!data.Stacks[0]) {
      return false;
    }
    let stackStatus = data.Stacks[0].StackStatus;
    let stackExistsDict = {
      CREATE_COMPLETE: true,
      UPDATE_COMPLETE: true,
      UPDATE_ROLLBACK_COMPLETE: true
    };

    if (stackExistsDict[stackStatus]) {
      return true;
    }
    if (stackStatus === 'REVIEW_IN_PROGRESS') {
      return false;
    }
    if (stackStatus === 'ROLLBACK_COMPLETE') {
      console.log('Current status of stack is ROLLBACK_COMPLETE, deleting before generating a new stack.');
      await this.cloudFormationClient.deleteStack({ StackName: stackName }).promise();
      for (let checkIteration = 0; checkIteration < 120; checkIteration++) {
        try {
          await this.cloudFormationClient.describeStacks({ StackName: stackName }).promise();
          await new Promise(resolve => setTimeout(resolve, 5000));
        } catch (error) {
          break;
        }
      }
      return false;
    }
    throw { error: 'Current status of stack prevents creation or update.', status: stackStatus };
  }

  async waitForCompletion(stackName, allowUpdateRollback) {
    let timeout = new Date();
    let timeoutLength = 60 * 60 * 1000;
    timeout.setTime(timeout.getTime() + timeoutLength);
    let nextWaitTime = 10;
    let getTimeoutPromise = () => new Promise(resolve => setTimeout(() => resolve(), Math.min((nextWaitTime *= 1.5), 300) * 1000));
    let maxErrors = 5;
    let totalErrors = 0;

    let iteratePromise = () => {
      if (new Date() > timeout) {
        throw { error: 'Timeout reached waiting for stack completion.', timeout: timeoutLength };
      }
      return getTimeoutPromise().then(() => {
        return this.cloudFormationClient.describeStacks({ StackName: stackName }).promise()
        .then(data => data.Stacks[0].StackStatus)
        .catch(error => {
          if (maxErrors >= totalErrors) {
            throw { error: 'failed to get stack status after multiple retries', errorCount: totalErrors, details: error };
          }
          maxErrors += 1;
        });
      }).then(async stackStatus => {
        console.log(`Current status of stack ${stackName} is ${stackStatus}.`);
        if (stackStatus === 'REVIEW_IN_PROGRESS') {
          throw { error: 'Current status of the stack has failed', status: stackStatus };
        }

        if (!allowUpdateRollback && stackStatus === 'UPDATE_ROLLBACK_COMPLETE' || stackStatus === 'ROLLBACK_COMPLETE') {
          const eventsResponse = await this.cloudFormationClient.describeStackEvents({ StackName: stackName }).promise();
          const failureStackEventStatuses = {
            CREATE_FAILED: true,
            UPDATE_FAILED: true,
            DELETE_FAILED: true,
            IMPORT_FAILED: true,
            IMPORT_ROLLBACK_FAILED: true,
            UPDATE_ROLLBACK_FAILED: true,
            ROLLBACK_FAILED: true
          };
          const mappedResults = eventsResponse.StackEvents.filter(event => failureStackEventStatuses[event.ResourceStatus]).map(result => ({
            cloudFormationResourceName: result.LogicalResourceId, awsResourceId: result.PhysicalResourceId, error: result.ResourceStatusReason
          }));
          console.error('Stack status indicates failure because of the following events: ', mappedResults);

          throw { title: 'Deployment to the stack failed.', status: stackStatus, code: stackStatus };
        }

        if (stackStatus.match(/PROGRESS$/i)) {
          return iteratePromise();
        }

        if (stackStatus.match(/COMPLETE$/i)) {
          return true;
        }

        throw { error: 'Current status of stack prevents creation or update.', status: stackStatus };
      });
    };

    // start waiting after 10 seconds stack takes a little while to pick up changes
    await new Promise(resolve => setTimeout(() => resolve(), 10 * 1000));
    await iteratePromise();
  }

  async waitForChangeSetCreation(stackName, changeSetName) {
    let timeout = new Date();
    let timeoutLength = 60 * 1000;
    timeout.setTime(timeout.getTime() + timeoutLength);
    let getTimeoutPromise = () => new Promise(resolve => setTimeout(() => resolve(), 1000));
    let maxErrors = 20;
    let totalErrors = 0;

    let iteratePromise = () => {
      if (new Date() > timeout) {
        throw { error: 'Timeout reached waiting for stack change set creation.', timeout: timeoutLength };
      }
      return getTimeoutPromise().then(() => {
        return this.cloudFormationClient.describeChangeSet({ StackName: stackName, ChangeSetName: changeSetName }).promise()
        .catch(error => {
          if (maxErrors >= totalErrors) {
            throw { error: 'failed to get change set status after multiple retries', errorCount: totalErrors, details: error };
          }
          maxErrors += 1;
        });
      }).then(changeSet => {
        console.log(`Current status of change set ${stackName}/${changeSetName} is ${changeSet.ExecutionStatus}@${changeSet.Status}.`);
        if (changeSet.Status === 'FAILED') {
          throw { error: 'Current status of the changeSet has failed', status: changeSet.Status };
        }

        if (changeSet.Status.match(/(PROGRESS|PENDING)$/i)) {
          return iteratePromise();
        }

        if (changeSet.Status === 'DELETE_COMPLETE') {
          throw { error: 'Failed to create stack, it was deleted.', status: changeSet.Status };
        }

        if (changeSet.Status.match(/COMPLETE$/i)) {
          return true;
        }

        throw { error: 'Current status of change set has not been computed.', status: changeSet.Status };
      });
    };

    // New stack set changes take about 5 seconds to be created
    await new Promise(resolve => setTimeout(() => resolve(), 5 * 1000));
    await iteratePromise();
  }

  async deployTemplate(template, options = {}, parameters = {}, bucketDeploymentKey) {
    if (template === null) { throw { error: '{template} object must be defined.' }; }
    if (options.stackName === null) { throw { error: '{options.stackName} is a required property.' }; }

    let region = this.cloudFormationClient.config.region;
    console.log(`Starting Configuration of Stack: ${options.stackName} in ${region}`);

    let stackExists = await this.stackExists(options.stackName);
    let stackParameters = {
      ChangeSetName: options.changeSetName,
      StackName: options.stackName,
      Capabilities: ['CAPABILITY_IAM', 'CAPABILITY_NAMED_IAM'],
      ChangeSetType: stackExists ? 'UPDATE' : 'CREATE',
      Parameters: Object.keys(parameters).map(p => ({ ParameterKey: p, ParameterValue: parameters[p] })),
      Tags: options.tags ? Object.keys(options.tags).map(t => ({ Key: t, Value: options.tags[t] })) : null
    };
    let templateString = this.getTemplateBody(template);

    if (stackExists) {
      const currentStackTemplate = await this.cloudFormationClient.getTemplate({ StackName: options.stackName, TemplateStage: 'Original' }).promise();
      const currentStackData = await this.cloudFormationClient.describeStacks({ StackName: options.stackName }).promise().then(data => data.Stacks[0]);
      if (isEqual(tryParseJson(currentStackTemplate.TemplateBody), tryParseJson(templateString))
        && Object.keys(parameters).every(key => currentStackData.Parameters.find(p => p.ParameterKey === key && p.ParameterValue === parameters[key]))) {
        console.log('Skipping deployment of stack because template matches existing CF stack template');
        return Object.assign({ title: 'Change set skipped, no changes detected.', code: 'SKIPPED' }, currentStackData);
      }
    }

    if (this.deploymentBucket) {
      let templateUrl = `${bucketDeploymentKey}/${options.stackName}.cloudformation.template`;
      stackParameters.TemplateURL = `https://s3.amazonaws.com/${this.deploymentBucket}/${templateUrl}`;
      await new Promise((resolve, reject) => {
        Tmp.file(async (err, path) => {
          if (err) {
            reject(err);
            return;
          }

          try {
            await fs.writeFile(path, templateString, 'utf-8');
            await this.bucketManager.DeployLambdaPromise(this.deploymentBucket, path, templateUrl);
            resolve();
          } catch (asyncError) {
            reject(asyncError);
          }
        });
      });
    } else {
      stackParameters.TemplateBody = templateString;
    }

    let executeParameters = {
      ChangeSetName: options.changeSetName,
      StackName: options.stackName
    };

    console.log(`Deploying Stack: ${options.stackName} in ${region}`);
    try {
      await this.cloudFormationClient.createChangeSet(stackParameters).promise();
      await this.waitForChangeSetCreation(options.stackName, options.changeSetName);
      await this.cloudFormationClient.executeChangeSet(executeParameters).promise();
    } catch (error) {
      if (error.code === 'ValidationError' || error.code === 'MultipleValidationErrors' || error.code === 'InvalidParameterType') {
        throw error;
      }
      let changeSetResponse = await this.cloudFormationClient.describeChangeSet(executeParameters).promise();
      let noUpdatesDict = {
        "The submitted information didn't contain changes. Submit different information to create a change set.": true,
        'No updates are to be performed.': true
      };
      if (!noUpdatesDict[changeSetResponse.StatusReason]) {
        let changeSetFailureError = { title: 'Failed to create changeset', details: changeSetResponse };
        throw changeSetFailureError;
      }

      try {
        await this.cloudFormationClient.deleteChangeSet(executeParameters).promise();
        await this.waitForCompletion(options.stackName, true);
      } catch (failedChangeSetDeletionFailure) {
        /* Failed to delete bad changes set */
      }
      const stackData = await this.cloudFormationClient.describeStacks({ StackName: options.stackName }).promise();
      return Object.assign({ title: 'Change set skipped, no changes detected.', code: 'SKIPPED' }, stackData.Stacks[0]);
    }

    await this.waitForCompletion(options.stackName, false);
    let stackData = await this.cloudFormationClient.describeStacks({ StackName: options.stackName }).promise();
    // make options default to protect the stack
    if (options.automaticallyProtectStack !== false) {
      try {
        await this.cloudFormationClient.updateTerminationProtection({ EnableTerminationProtection: true, StackName: options.stackName }).promise();
      } catch (error) {
        console.log('Failed to update termination protection', error);
      }
    }

    return stackData.Stacks[0];
  }

  async stackSetExists(stackSetName) {
    try {
      await this.cloudFormationClient.describeStackSet({ StackSetName: stackSetName }).promise();
      return true;
    } catch (error) {
      if (error.code === 'StackSetNotFoundException') {
        return false;
      }
      throw error;
    }
  }

  async deployStackSetTemplate(accountId, template, options = {}, parameters = {}, bucketDeploymentKey) {
    if (template === null) { throw { error: '{template} object must be defined.' }; }
    if (options.stackSetName === null) { throw { error: '{options.stackSetName} is a required property.' }; }
    if (!bucketDeploymentKey) { throw { error: '{bucketDeploymentKeys} is a required property.' }; }

    console.log(`Starting Configuration of the StackSet: ${options.stackSetName}`);

    const templateString = this.getTemplateBody(template);
    const templateUrl = `${bucketDeploymentKey}/${options.stackSetName}.cloudformation-stackset.template`;
    const stackParameters = {
      StackSetName: options.stackSetName,
      Capabilities: ['CAPABILITY_IAM', 'CAPABILITY_NAMED_IAM', 'CAPABILITY_AUTO_EXPAND'],
      Tags: options.tags ? Object.keys(options.tags).map(t => ({ Key: t, Value: options.tags[t] })) : undefined,
      TemplateBody: this.getTemplateBody({
        AWSTemplateFormatVersion: '2010-09-09',
        Resources: {
          InnerStack: {
            Type: 'AWS::CloudFormation::Stack',
            Properties: {
              Parameters: parameters,
              Tags: options.tags ? Object.keys(options.tags).map(t => ({ Key: t, Value: options.tags[t] })) : undefined,
              TemplateURL: `https://s3.amazonaws.com/${this.deploymentBucket}/${templateUrl}`,
              TimeoutInMinutes: 180
            }
          }
        }
      })
    };

    const uploadTemplate = async () => {
      await new Promise((resolve, reject) => {
        Tmp.file(async (err, path) => {
          if (err) {
            reject(err);
            return;
          }

          try {
            await fs.writeFile(path, templateString, 'utf-8');
            await this.bucketManager.DeployLambdaPromise(this.deploymentBucket, path, templateUrl);
            resolve();
          } catch (asyncError) {
            reject(asyncError);
          }
        });
      });
    };

    const stackExists = await this.stackSetExists(options.stackSetName);
    if (!stackExists) {
      console.log('Create stack set...');
      await uploadTemplate();
      await this.cloudFormationClient.createStackSet(stackParameters).promise();
    }

    const existingStacks = await this.cloudFormationClient.listStackInstances({ StackSetName: options.stackSetName }).promise().then(data => data.Summaries);
    const existingRegions = existingStacks.map(s => s.Region);
    const newRegions = options.regions.filter(r => !existingRegions.some(e => e === r));

    // If the stack already existed, and there are no new regions, all the stacks are updated then check to see if the template matches the new template
    if (stackExists && !newRegions && existingStacks.every(s => s.Status === 'CURRENT')) {
      const regionStacks = await this.cloudFormationClient.listStacks({ StackStatusFilter: ['CREATE_COMPLETE', 'UPDATE_COMPLETE', 'UPDATE_ROLLBACK_COMPLETE'] }).promise()
      .then(r => r.StackSummaries);

      const thisRegionsStackId = existingStacks.find(s => s.Region === this.cloudFormationClient.config.region).StackId;
      const nestedStackForRegion = regionStacks.find(s => s.RootId === thisRegionsStackId).StackName;

      const currentStackTemplate = await this.cloudFormationClient.getTemplate({ StackName: nestedStackForRegion, TemplateStage: 'Original' }).promise();
      const currentStackData = await this.cloudFormationClient.describeStacks({ StackName: nestedStackForRegion }).promise().then(data => data.Stacks[0]);
      if (isEqual(tryParseJson(currentStackTemplate.TemplateBody), tryParseJson(templateString))
        && Object.keys(parameters).every(key => currentStackData.Parameters.find(p => p.ParameterKey === key && p.ParameterValue === parameters[key]))) {
        console.log('Skipping deployment of stackset because template matches existing CF stack template');
        return { title: 'Change set skipped, no changes detected.', code: 'SKIPPED' };
      }
    }

    if (stackExists) {
      console.log('Updating stack set...');
      stackParameters.OperationId = `${options.changeSetName}-update`;
      stackParameters.OperationPreferences = {
        FailureToleranceCount: 20,
        MaxConcurrentCount: 20,
        RegionConcurrencyType: 'PARALLEL'
      };

      await uploadTemplate();
      await this.cloudFormationClient.updateStackSet(stackParameters).promise();

      for (let iteration = 0; iteration < 480; iteration++) {
        const operation = await this.cloudFormationClient.describeStackSetOperation({ StackSetName: options.stackSetName, OperationId: stackParameters.OperationId }).promise();
        if (operation.StackSetOperation.Status === 'SUCCEEDED') {
          const updatedStacks = await this.cloudFormationClient.listStackInstances({ StackSetName: options.stackSetName }).promise().then(data => data.Summaries);
          if (updatedStacks.some(s => s.Status !== 'CURRENT')) {
            throw { title: 'Some stacks failed to update', operation, stacks: updatedStacks, options, stackParameters };
          }
          break;
        }
        if (operation.StackSetOperation.Status === 'FAILED') {
          throw { title: 'Failed to Update stack set', operation, options, stackParameters };
        }
        await new Promise(resolve => setTimeout(resolve, 15000));

        if (iteration > 400) {
          throw { title: 'Timeout', options, stackParameters };
        }
      }
    }

    const createParams = {
      StackSetName: options.stackSetName,
      Accounts: [accountId],
      Regions: newRegions,
      OperationId: options.changeSetName,
      OperationPreferences: {
        FailureToleranceCount: 20,
        MaxConcurrentCount: 20,
        RegionConcurrencyType: 'PARALLEL'
      }
    };
    if (createParams.Regions.length) {
      console.log(`Create a stack instance in regions: ${createParams.Regions.join(', ')}`);
      await this.cloudFormationClient.createStackInstances(createParams).promise();

      for (let iteration = 0; iteration < 480; iteration++) {
        const operation = await this.cloudFormationClient.describeStackSetOperation({ StackSetName: options.stackSetName, OperationId: createParams.OperationId }).promise();
        if (operation.StackSetOperation.Status === 'SUCCEEDED') {
          const updatedStacks = await this.cloudFormationClient.listStackInstances({ StackSetName: options.stackSetName }).promise().then(data => data.Summaries);
          if (updatedStacks.some(s => s.Status !== 'CURRENT')) {
            throw { title: 'Some stacks failed to update', operation, stacks: updatedStacks, options, stackParameters };
          }
          break;
        }
        if (operation.StackSetOperation.Status === 'FAILED') {
          throw { title: 'Failed to create instance for regions.', operation };
        }
        await new Promise(resolve => setTimeout(resolve, 15000));
        if (iteration > 400) {
          throw { title: 'Timeout', details: 'Failed to create instances for stack that do not exist yet', options, stackParameters };
        }
      }
    }

    return { title: 'Success' };
  }

  async configureStackSetForAwsOrganization(template, options = {}, parameters = {}) {
    if (template === null) { throw { error: '{template} object must be defined.' }; }
    if (options.stackSetName === null) { throw { error: '{options.stackSetName} is a required property.' }; }

    console.log(`Starting Configuration of the StackSet: ${options.stackSetName}`);

    const templateString = this.getTemplateBody(template);
    const stackParameters = {
      StackSetName: options.stackSetName,
      AutoDeployment: {
        Enabled: true,
        RetainStacksOnAccountRemoval: false
      },
      ManagedExecution: {
        Active: true
      },
      Description: 'Deployed as an Organizational stack set',
      PermissionModel: 'SERVICE_MANAGED',
      Capabilities: ['CAPABILITY_IAM', 'CAPABILITY_NAMED_IAM', 'CAPABILITY_AUTO_EXPAND'],
      Tags: options.tags ? Object.keys(options.tags).map(t => ({ Key: t, Value: options.tags[t] })) : undefined,
      TemplateBody: templateString
    };

    const stackExists = await this.stackSetExists(options.stackSetName);
    if (!stackExists) {
      console.log('Create stack set...');
      await this.cloudFormationClient.createStackSet(stackParameters).promise();
    }

    const currentStackData = await this.cloudFormationClient.describeStackSet({ StackSetName: options.stackSetName }).promise().then(data => data.StackSet);
    const rawRegions = await new EC2().describeRegions().promise().then(data => data.Regions.map(r => r.RegionName));
    const newRegions = rawRegions.filter(r => !currentStackData.Regions || !currentStackData.Regions.some(e => e === r))
    .filter(r => r !== 'eu-central-2' && r !== 'ap-south-2' && r !== 'eu-south-2' && r !== 'me-central-1' && r !== 'ap-southeast-4');

    // If the stack already existed, and there are no new regions, all the stacks are updated then check to see if the template matches the new template
    if (stackExists && !newRegions.length) {
      if (isEqual(tryParseJson(currentStackData.TemplateBody), tryParseJson(templateString))
        && Object.keys(parameters).every(key => currentStackData.Parameters.find(p => p.ParameterKey === key && p.ParameterValue === parameters[key]))) {
        console.log('Skipping deployment of stackset because template matches existing CF stack template');
        return { title: 'Change set skipped, no changes detected.', code: 'SKIPPED' };
      }
    }

    if (stackExists) {
      console.log('Updating organizational stack set, stack will be updated asynchronously');
      stackParameters.OperationId = `${options.changeSetName}-update`;
      stackParameters.OperationPreferences = {
        FailureToleranceCount: 20,
        MaxConcurrentCount: 20,
        RegionConcurrencyType: 'PARALLEL'
      };

      await this.cloudFormationClient.updateStackSet(stackParameters).promise();
    }

    const rootOrgsInfo = await new Organizations({ region: 'us-east-1' }).listRoots({}).promise();

    const deployToAdditionalRegionsParams = {
      StackSetName: options.stackSetName,
      DeploymentTargets: {
        OrganizationalUnitIds: rootOrgsInfo.Roots.map(org => org.Id)
      },
      Regions: newRegions,
      OperationId: options.changeSetName,
      OperationPreferences: {
        FailureToleranceCount: 20,
        MaxConcurrentCount: 20,
        RegionConcurrencyType: 'PARALLEL'
      }
    };
    if (deployToAdditionalRegionsParams.Regions.length || deployToAdditionalRegionsParams.DeploymentTargets.OrganizationalUnitIds.length) {
      console.log(`Tracking StackSet accounts in Orgs: ${deployToAdditionalRegionsParams.DeploymentTargets.OrganizationalUnitIds.join(', ')}`);
      await this.cloudFormationClient.createStackInstances(deployToAdditionalRegionsParams).promise();
    }

    return { title: 'Success' };
  }
}

module.exports = CloudFormationDeployer;
