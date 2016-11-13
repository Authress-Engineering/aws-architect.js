# AWS Architect
It should be easy, and it also should be automated. But both of those things usually aren't free.  The ideal world has magic AI which can communicate with each other to a such a degree which doesn't require software architects to think about what the global picture has to be before an organization and deliver something of value.  The AWS Architect, attempts to eliminate the burden of projecting your vision of software to AWS.  AWS Architects your service using [Microservices](./docs/microservices/index.md).

[![npm version](https://badge.fury.io/js/aws-architect.svg)](https://badge.fury.io/js/aws-architect)
[![Build Status](https://travis-ci.org/wparad/AWS-Architect.svg?branch=master)](https://travis-ci.org/wparad/AWS-Architect)

## Usage

### Creating microservice `init`
This will also configure your aws account to allow your build system to automatically deploy to AWS.  It does this by creating a deployer role, which will have access to modifying the necessary resources.

* Create git repository and clone locally
* `sudo npm install aws-architect -g`
* `aws-architect init`
* `npm install`
* Update:
	* `package.json`: package name
	* `make.js`: publish command, and database structure to match your service requirements

#### API Sample

```javascript
	var aws = require('aws-sdk');
	var Api = require('openapi-factory');
	var api = new Api();
	module.exports = api;

	api.get('/sample', (request) => {
		return {'Value': 1};
	});
```

##### Lambda with no API sample

```javascript
	exports.handler = (event, context, callback) => {
		console.log(`event: ${JSON.stringify(event, null, 2)}`);
		console.log(`context: ${JSON.stringify(context, null, 2)}`);
		callback(null, {Event: event, Context: context});
	};
````
##### Set a custom authorizer

```javascript
	api.SetAuthorizer((authorizationTokenInfo, methodArn) => {
		return {
			principalId: 'computed-authorized-principal-id',
			policyDocument: {
				Version: '2012-10-17',
				Statement: [
					{
						Action: 'execute-api:Invoke',
						Effect: 'Deny',
						Resource: methodArn //'arn:aws:execute-api:*:*:*'
					}
				]
			}
		}
	});
```

#### S3 Website Deployment
Specify `bucket` in the configuration options for `contentOptions`, and configure the `PublishWebsite` function in the make.js file.

```javascript
	awsArchitect.PublishWebsite('deadc0de-1')
	.then((result) => console.log(`${JSON.stringify(result, null, 2)}`))
	.catch((failure) => console.log(`Failed to upload website ${failure} - ${JSON.stringify(failure, null, 2)}`));

	awsArchitect.PromoteToStage('deadc0de-1', 'production')
	.then((result) => console.log(`${JSON.stringify(result, null, 2)}`))
	.catch((failure) => console.log(`Failed copying stage to production ${failure} - ${JSON.stringify(failure, null, 2)}`));
````

## Built-in functionality

* Authorization flow created in index.html for the website (static content)
* conventioned based static S3 website using the `/content` directory
* conventioned based lambda functions specified as an argument to the associated functions.
* Creates a ServiceRole to execute Lambda functions.
* Lambda/API Gateway setup for seemless integration.
* Automatic creation of AWS resources when using `AwsArchitect.PublishPromise()`. Including:
	* Lambda functions
	* API Gateway resources
	* Environments for managing resources in AWS
* Local user testing platform, to run lambdas and static content as a local express Node.js service.

### Service Configuration
See [template service documentation](./bin/template/README.md) for how individual parts of the service are configured.

## Also

### AWS Documentation

* [Lambda](http://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/Lambda.html)
* [Node SDK](http://docs.aws.amazon.com/AWSJavaScriptSDK/guide/node-configuring.html)