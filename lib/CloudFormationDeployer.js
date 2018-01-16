module.exports = function CloudFormationDeployer(cloudFormationClient) {
	this.cloudFormationClient = cloudFormationClient;

	this.validateTemplate = function(template) {
		return this.cloudFormationClient.validateTemplate({ TemplateBody: JSON.stringify(template, null, 2) }).promise();
	};

	this.stackExists = function(stackName) {
		return this.cloudFormationClient.describeStacks({ StackName: stackName }).promise()
		.then(data => {
			if (!data.Stacks[0]) {
				return false;
			}
			let stackStatus = data.Stacks[0].StackStatus;
			let stackExistsDict = {
				'CREATE_COMPLETE': true,
				'UPDATE_COMPLETE': true,
				'UPDATE_ROLLBACK_COMPLETE': true
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
		let waitPromise = Promise.resolve();
		let timeout = new Date();
		let timeoutLength = 60 * 60 * 1000;
		timeout.setTime(timeout.getTime() + timeoutLength);
		let getTimeoutPromise = () => new Promise((resolve, reject) => setTimeout(() => resolve(), 15 * 1000));
		let maxErrors = 5;
		let totalErrors = 0;

		let iteratePromise = () => {
			if (new Date() > timeout) {
				throw { error: 'Timeout reached waiting for stack completion.', status: stackStatus, timeout: timeoutLength };
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

				if (!allow_update_rollback && stackStatus.match(/UPDATE_ROLLBACK_COMPLETE/i)) {
					throw { title: 'Current stack status is failure', status: stackStatus };
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

		// start waiting after 20 seconds
		return new Promise((resolve, reject) => setTimeout(() => resolve(), 20 * 1000)).then(() => iteratePromise());
	};

	this.deployTemplate = function(template, options = {}, parameters = {}) {
		if (template === null) { throw { error: '{template} object must be defined.'}; }
		if (options.stackName === null) { throw { error: '{options.stackName} is a required property.' }; }

		let region = this.cloudFormationClient.config.region;
		console.log(`Starting Configuration of Stack: ${options.stackName} in ${region}`);

		return this.stackExists(options.stackName)
		.then(stackExists => {
			let stackParameters = {
				ChangeSetName: options.changeSetName,
				StackName: options.stackName,
				Capabilities: ['CAPABILITY_IAM', 'CAPABILITY_NAMED_IAM'],
				ChangeSetType: stackExists ? 'UPDATE' : 'CREATE',
				TemplateBody: JSON.stringify(template, null, 2),
				Parameters: Object.keys(parameters).map(p => ({ ParameterKey: p, ParameterValue: parameters[p] })),
				Tags: options.tags ? Object.keys(options.tags).map(t => ({ Key: t, Value: options.tags[t] })) : null
			};

			let executeParameters = {
				ChangeSetName: options.changeSetName,
				StackName: options.stackName
			};

			console.log(`Deploying Stack: ${options.stackName} in ${region}`);
			return this.cloudFormationClient.createChangeSet(stackParameters).promise()
			.then(() => {
				return this.cloudFormationClient.waitFor('changeSetCreateComplete', executeParameters).promise();
			})
			.then(() => {
				return this.cloudFormationClient.executeChangeSet(executeParameters).promise()
				.then(() => this.waitForCompletion(options.stackName, false));
			}, failure => {
				return this.cloudFormationClient.describeChangeSet(executeParameters).promise()
				.then(changeSetResponse => {
					if (changeSetResponse.StatusReason === 'No updates are to be performed.') {
						return this.cloudFormationClient.deleteChangeSet(executeParameters).promise();
					} else {
						let error = { title: 'Failed to create changeset', details: changeSetResponse };
						throw error;
					}
				})
				.then(() => this.waitForCompletion(options.stackName, true));
			});
		})
		.then(() => {
			return this.cloudFormationClient.describeStacks({ StackName: options.stackName }).promise();
		});
	};
};