var path = require('path');

function ApiConfiguration(options, lambdaFileName) {
	if (!(this instanceof ApiConfiguration)) {
		throw new Error('Configurations must be instantiated.');
	}

	var configuration = options || {};

	var functionName = path.basename(lambdaFileName, '.js');
	this.Regions = configuration.regions || ['us-east-1'];
	this.FunctionName = functionName;
	this.Handler = configuration.handler || `${functionName}.handler`;
	this.Role = configuration.role;
	this.Runtime = configuration.runtime || 'nodejs4.3';
	this.Description = configuration.description || functionName;
	this.MemorySize = configuration.memorySize || 128;
	this.Publish = configuration.publish || true;
	this.Timeout = configuration.timeout || 3;
	this.SecurityGroupIds = configuration.securityGroupIds || [];
	this.SubnetIds = configuration.subnetIds || [];
}

module.exports = ApiConfiguration;