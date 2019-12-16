function LambdaManager(serviceName, lambdaFactory) {
	this.ServiceName = serviceName;
	this.LambdaFactory = lambdaFactory;
}

LambdaManager.prototype.PublishNewVersion = function(functionName, bucket, deploymentKey) {
	return this.LambdaFactory.updateFunctionCode({
		FunctionName: functionName,
		Publish: true,
		S3Bucket: bucket,
		S3Key: deploymentKey
	}).promise();
};

LambdaManager.prototype.SetAlias = function(functionName, stageName, version) {
	let params = {
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
			return this.LambdaFactory.addPermission(params).promise().then(innerData => JSON.parse(innerData.Statement));
		}
		return null;
	});
};

module.exports = LambdaManager;
