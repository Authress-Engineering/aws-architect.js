const { Lambda } = require('aws-sdk');

function LambdaManager(region) {
	this.LambdaFactory = new Lambda({ region });
}

LambdaManager.prototype.PublishNewVersion = function(functionName, bucket, deploymentKey) {
	return this.LambdaFactory.updateFunctionCode({
		FunctionName: functionName,
		Publish: true,
		S3Bucket: bucket,
		S3Key: deploymentKey
	}).promise();
};

LambdaManager.prototype.getAliasMap = async function(functionName) {
	let nextToken;
	let aliases = [];
	do {
		const functionsBatch = await this.LambdaFactory.listAliases({ FunctionName: functionName, Marker: nextToken }).promise();
		aliases = aliases.concat(functionsBatch.Aliases);
		nextToken = functionsBatch.NextMarker;
	} while (nextToken);

	const versionAliasMap = {};
	aliases.forEach(alias => {
		if (!versionAliasMap[alias.FunctionVersion]) {
			versionAliasMap[alias.FunctionVersion] = [];
		}
		versionAliasMap[alias.FunctionVersion].push(alias.Name);
	});
	return versionAliasMap;
};

LambdaManager.prototype.cleanupProduction = async function(functionName, forceRemovalOfAliases = false, dryRun = true) {
	const keepFunctionsYoungerThanDays = 60;
	let nextToken;
	let versions = [];

	// get lambda versions
	do {
		const functionsBatch = await this.LambdaFactory.listVersionsByFunction({ FunctionName: functionName, Marker: nextToken }).promise();
		versions = versions.concat(functionsBatch.Versions);
		nextToken = functionsBatch.NextMarker;
	} while (nextToken);

	// log statistics
	const totalCodeSize = versions.map(f => f.CodeSize).reduce((prev, curr) => prev + curr, 0);
	console.log(`Total code size of all versions: ${Math.floor(totalCodeSize / 2 ** 20)} MB`);

	// filter out newer versions to only cleanup old versions
	const cutoff = new Date();
	cutoff.setDate(new Date().getDate() - keepFunctionsYoungerThanDays);
	const productionAliasData = await this.LambdaFactory.getAlias({ FunctionName: functionName, Name: 'production' }).promise();
	const versionsToDelete = versions.slice(0, -10).filter(f => f.LastModified < cutoff.toISOString() && f.Version !== '$LATEST' && f.Version !== productionAliasData.FunctionVersion);

	if (!versionsToDelete.length) {
		return;
	}

	const versionAliasMap = await this.getAliasMap(functionName);

	// log statistics of versions that will be deleted
	const codeSize = versionsToDelete.map(f => f.CodeSize).reduce((prev, curr) => prev + curr, 0);
	console.log(`Code size to be deleted: ${Math.round(codeSize / 2 ** 20)} MB`);
	console.log(`${versionsToDelete.length} Versions to be deleted`);

	for (const versionData of versionsToDelete) {
		console.log(`${dryRun ? '[DRY RUN][DELETING]' : '[DELETING]'}: Function ${versionData.FunctionName} Version: ${versionData.Version} with size ${Math.floor(versionData.CodeSize / 2 ** 20)} MB.`);
		if (!dryRun) {
			if (forceRemovalOfAliases) {
				for (const alias of (versionAliasMap[versionData.Version] || []).filter(a => !a.match(/production/))) {
					await this.LambdaFactory.deleteAlias({ FunctionName: functionName, Name: alias }).promise();
				}
			}
			await this.LambdaFactory.deleteFunction({ FunctionName: functionName, Qualifier: versionData.Version }).promise();
		}
	}
};

LambdaManager.prototype.SetAlias = async function(functionName, stageName, version) {
	let previousAliasData;
	try {
		previousAliasData = await this.LambdaFactory.getAlias({ FunctionName: functionName, Name: stageName }).promise();
	} catch (error) {
		if (error.code !== 'ResourceNotFoundException') {
			throw error;
		}
	}

	const params = { FunctionName: functionName, FunctionVersion: version, Name: stageName, Description: `Alias for API Gateway Stage ${stageName}` };
	if (!previousAliasData) {
		await this.LambdaFactory.createAlias(params).promise();
		return;
	}

	// else update the alias
	await this.LambdaFactory.updateAlias(params).promise();

	// Attempt to clean up previous version unless production or the special $LATEST version
	if (stageName.match(/production/) || previousAliasData.FunctionVersion.match('$LATEST')) {
		return;
	}

	try {
		await this.LambdaFactory.deleteFunction({ FunctionName: functionName, Qualifier: previousAliasData.FunctionVersion }).promise();
	} catch (error) {
		// If this fails it's because there is still an alias pointing at it, so ignore
		if (error.code !== 'ResourceConflictException') {
			throw error;
		}
	}
};

LambdaManager.prototype.removeVersion = async function(functionName, stageName) {
	const params = { FunctionName: functionName, Name: stageName };

	// Ignore removing versions for production
	if (stageName.match(/production/)) {
		return;
	}

	let aliasData;
	try {
		aliasData = await this.LambdaFactory.getAlias(params).promise();
	} catch (error) {
		if (error.code === 'ResourceNotFoundException') {
			return;
		}
		throw error;
	}

	await this.LambdaFactory.deleteAlias(params).promise();

	// We can't delete the special $LATEST version
	if (aliasData.FunctionVersion.match('$LATEST')) {
		return;
	}

	// List Aliases is broken for FunctionVersion, and no expectation of AWS fixing this
	// const versionAliases = await this.LambdaFactory.listAliases({ FunctionName: functionName, FunctionVersion: aliasData.FunctionVersion }).promise();
	// if (!versionAliases.Aliases.length || versionAliases.Aliases.length === 1 && versionAliases.Aliases[0].Name === stageName) {
	const versionAliasMap = await this.getAliasMap(functionName);
	if (!versionAliasMap[aliasData.FunctionVersion] || !versionAliasMap[aliasData.FunctionVersion].length
    || versionAliasMap[aliasData.FunctionVersion].length === 1 && versionAliasMap[aliasData.FunctionVersion][0] === stageName) {
		await this.LambdaFactory.deleteFunction({ FunctionName: functionName, Qualifier: aliasData.FunctionVersion }).promise();
	}
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
