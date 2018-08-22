module.exports = function CloudFormationDeployer(cloudFormationClient) {
	this.cloudFormationClient = cloudFormationClient;

	this.getTemplateBody = function(template) {
		// If the template object has a field "Resources" or "AWSTemplateFormatVersion", we assume the object is a JavaScript object
		// matching the CloudFormation template in JSON format.
		// If that value isn't there, simply return the template since it could be the raw format already (in JSON or YML format).
		if (template.Resources || template.AWSTemplateFormatVersion) {
			return JSON.stringify(template, null, 2);
		}
		return template;
	}

	this.validateTemplate = function(template) {
		return this.cloudFormationClient.validateTemplate({ TemplateBody: getTemplateBody(template) }).promise();
	};

	this.stackExists = function(stackName) {
		return this.cloudFormationClient.describeStacks({ StackName: stackName }).promise()
		.then(data => {
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
				throw { error: 'Stack must be deleted manually and cannot be used', status: stackStatus };
			}
			throw { error: 'Current status of stack prevents creation or update.', status: stackStatus };
		}, () => false);
	};

	this.waitForCompletion = function(stackName, allow_update_rollback) {
		let timeout = new Date();
		let timeoutLength = 60 * 60 * 1000;
		timeout.setTime(timeout.getTime() + timeoutLength);
		let getTimeoutPromise = () => new Promise(resolve => setTimeout(() => resolve(), 15 * 1000));
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
			}).then(stackStatus => {
				console.log(`Current status of stack ${stackName} is ${stackStatus}.`);
				if (stackStatus === 'REVIEW_IN_PROGRESS') {
					throw { error: 'Current status of the stack has failed', status: stackStatus };
				}

				if (!allow_update_rollback && stackStatus === 'UPDATE_ROLLBACK_COMPLETE') {
					throw { title: 'Current stack status is failure', status: stackStatus };
				}

				if (stackStatus.match(/PROGRESS$/i)) {
					return iteratePromise();
				}

				if (stackStatus === 'ROLLBACK_COMPLETE') {
					throw { error: 'Failed to create stack, it must be deleted manually.', status: stackStatus };
				}

				if (stackStatus.match(/COMPLETE$/i)) {
					return true;
				}

				throw { error: 'Current status of stack prevents creation or update.', status: stackStatus };
			});
		};

		// start waiting after 20 seconds
		return new Promise(resolve => setTimeout(() => resolve(), 20 * 1000)).then(() => iteratePromise());
	};

	this.waitForChangeSetCreation = function(stackName, changeSetName) {
		let timeout = new Date();
		let timeoutLength = 60 * 1000;
		timeout.setTime(timeout.getTime() + timeoutLength);
		let getTimeoutPromise = () => new Promise(resolve => setTimeout(() => resolve(), 10 * 1000));
		let maxErrors = 5;
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

		// start waiting after 20 seconds
		return new Promise(resolve => setTimeout(() => resolve(), 5 * 1000)).then(() => iteratePromise());
	};

	this.deployTemplate = async function(template, options = {}, parameters = {}) {
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
			TemplateBody: getTemplateBody(template),
			Parameters: Object.keys(parameters).map(p => ({ ParameterKey: p, ParameterValue: parameters[p] })),
			Tags: options.tags ? Object.keys(options.tags).map(t => ({ Key: t, Value: options.tags[t] })) : null
		};

		let executeParameters = {
			ChangeSetName: options.changeSetName,
			StackName: options.stackName
		};

		console.log(`Deploying Stack: ${options.stackName} in ${region}`);
		try {
			await this.cloudFormationClient.createChangeSet(stackParameters).promise();
			await this.waitForChangeSetCreation(options.stackName, options.changeSetName);
			await this.cloudFormationClient.executeChangeSet(executeParameters).promise();
			await this.waitForCompletion(options.stackName, false);
			return this.cloudFormationClient.describeStacks({ StackName: options.stackName }).promise();
		} catch (error) {
			if (error.code === 'ValidationError') {
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
			return { title: 'Change set skipped, no changes detected.' };
		}
	};
};
