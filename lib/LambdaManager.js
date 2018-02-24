var fs = require('fs-extra');

function LambdaManager(serviceName, lambdaFactory, apiConfiguration) {
	this.ServiceName = serviceName;
	this.LambdaFactory = lambdaFactory;
	this.ApiConfiguration = apiConfiguration;
}

LambdaManager.prototype.PublishLambdaPromise = function(accountId, zipArchive, serviceRole) {
	var configuration = this.ApiConfiguration;
	var functionName = `${this.ServiceName}-${configuration.FunctionName}`;

	return this.LambdaFactory.listVersionsByFunction({ FunctionName: functionName, MaxItems: 1 }).promise()
	.then(() => {
		return this.LambdaFactory.updateFunctionConfiguration({
			FunctionName: functionName,
			Handler: configuration.Handler,
			Role: `arn:aws:iam::${accountId}:role/${serviceRole}`,
			Runtime: configuration.Runtime,
			Description: configuration.Description,
			MemorySize: configuration.MemorySize,
			Timeout: configuration.Timeout,
			VpcConfig: {
				SecurityGroupIds: configuration.SecurityGroupIds,
				SubnetIds: configuration.SubnetIds
			}
		}).promise()
		.then(() => this.LambdaFactory.updateFunctionCode({
			FunctionName: functionName,
			Publish: true,
			ZipFile: fs.readFileSync(zipArchive)
		}).promise());
	}, (failure) => {
		return this.LambdaFactory.createFunction({
			FunctionName: functionName,
			Code: { ZipFile: fs.readFileSync(zipArchive) },
			Handler: configuration.Handler,
			Role: `arn:aws:iam::${accountId}:role/${serviceRole}`,
			Runtime: configuration.Runtime,
			Description: configuration.Description,
			MemorySize: configuration.MemorySize,
			Publish: configuration.Publish,
			Timeout: configuration.Timeout,
			VpcConfig: {
				SecurityGroupIds: configuration.SecurityGroupIds,
				SubnetIds: configuration.SubnetIds
			}
		}).promise()
	})
	.catch((error) => {
		return Promise.reject({Error: error, Detail: error.stack});
	});
};

LambdaManager.prototype.PublishNewVersion = function(functionName, bucket, deploymentKey) {
	return this.LambdaFactory.updateFunctionCode({
		FunctionName: functionName,
		Publish: true,
		S3Bucket: bucket,
		S3Key: deploymentKey
	}).promise();
}

LambdaManager.prototype.SetAlias = function(functionName, stageName, version) {
	var params = {
		FunctionName: functionName,
		FunctionVersion: version,
		Name: stageName,
		Description: `Alias for API Gateway Stage ${stageName}`
	};
	return this.LambdaFactory.updateAlias(params).promise()
	.catch(error => {
		if (error.code === 'ResourceNotFoundException' && error.message.includes('Alias not found')) {
			return this.LambdaFactory.createAlias(params).promise();
		}
		throw error;
	});
};

LambdaManager.prototype.SetPermissionsPromise = function(accountId, lambdaArn, apiGatewayId, region, stageName) {
	let statementId = `${stageName}-execute`;
	let params = {
		Action: 'lambda:InvokeFunction',
		FunctionName: lambdaArn,
		Principal: 'apigateway.amazonaws.com',
		StatementId: statementId,
		SourceArn: `arn:aws:execute-api:${region}:${accountId}:${apiGatewayId}/*`
	};
	let getParams = { FunctionName: lambdaArn };
	if (stageName) {
		getParams.FunctionName = params.FunctionName = lambdaArn.split(':', 7).join(':');
		getParams.Qualifier = params.Qualifier = stageName;
	}

	return this.LambdaFactory.getPolicy(getParams).promise()
	.catch(() => null)
	.then(data => {
		if (!data || !data.Policy || !JSON.parse(data.Policy).Statement.find(s => s.Sid === statementId)) {
			return this.LambdaFactory.addPermission(params).promise().then(data => JSON.parse(data.Statement));
		}
		return Promise.resolve();
	});
}
module.exports = LambdaManager;