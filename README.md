# AWS Architect
It should be easy, and it also should be automated. But both of those things usually aren't free.  The ideal world has magic AI which can communicate with each other.  And to such a degree which doesn't require software architects to think about what the global picture is before an organization can deliver something of value.  The AWS Architect, attempts to eliminate the burden of projecting your vision of software to AWS.  AWS Architects your service using [Microservices](./docs/microservices/index.md).

[![npm version](https://badge.fury.io/js/aws-architect.svg)](https://badge.fury.io/js/aws-architect)
[![Build Status](https://travis-ci.org/wparad/aws-architect.js.svg?branch=master)](https://travis-ci.org/wparad/aws-architect.js)

## Usage

### Creating microservice: `init`
This will also configure your aws account to allow your build system to automatically deploy to AWS. Run locally

* Create git repository and clone locally
* `npm install aws-architect -g`
* `aws-architect init`
* `npm install`
* Update:
	* `package.json`: package name, the package name is used to name your resources
	* `make.js`: Deployment bucket, Resource, and DNS name parameters which are used for CF deployment

#### API Sample
Using `openapi-factory` we can create a declarative api to run inside the lambda function.

```javascript
	let aws = require('aws-sdk');
	let Api = require('openapi-factory');
	let api = new Api();
	module.exports = api;

	api.get('/sample', (request) => {
		return { statusCode: 200, body: { value: 1} };
	});
```

##### Lambda with no API sample
Additionally, `openapi-factory` is not required, and executing the lambda handler directly can be done as well.

```javascript
	exports.handler = (event, context, callback) => {
		console.log(`event: ${JSON.stringify(event, null, 2)}`);
		console.log(`context: ${JSON.stringify(context, null, 2)}`);
		callback(null, {Event: event, Context: context});
	};
```
##### Set a custom authorizer
In some cases authorization is necessary. Cognito is always an option, but for more fine grained control, your lambda can double as an authorizer.

```javascript
	api.SetAuthorizer(event => {
		return {
			principalId: 'computed-authorized-principal-id',
			policyDocument: {
				Version: '2012-10-17',
				Statement: [
					{
						Action: 'execute-api:Invoke',
						Effect: 'Deny',
						Resource: event.methodArn //'arn:aws:execute-api:*:*:*'
					}
				]
			},
			context: {
				"stringKey": "stringval",
				"numberKey": 123,
				"booleanKey": true
			}
		};
	});
```

### Library Functions
#### AwsArchitect class functions

```javascript
let packageMetadataFile = path.join(__dirname, 'package.json');
let packageMetadata = require(packageMetadataFile);

let apiOptions = {
	sourceDirectory: path.join(__dirname, 'src'),
	description: 'This is the description of the lambda function',
	regions: ['eu-west-1']
};
let contentOptions = {
	bucket: 'WEBSITE_BUCKET_NAME',
	contentDirectory: path.join(__dirname, 'content')
};
let awsArchitect = new AwsArchitect(packageMetadata, apiOptions, contentOptions);

// Package a directory in a zip archive and deploy to an S3 bucket, required for stage deployment and CF stack deployment
let options = {
	bucket: 'BUCKET_NAME'
};
publishLambdaArtifactPromise(options = {}) {...}

// Validate a cloud formation stack template usinc CloudFormation
validateTemplate(stackTemplate) {...}

// Deploy a Cloudformation template to AWS, should be used to create all the infrastructure required and run only on master branches
let stackConfiguration = {
	stackName: 'STACK_NAME'
	changeSetName: 'NAME_OF_CHANGE_SET'
};
let parameters = { /** PARAMATERS_FOR_YOUR_TEMPLATE, but also include these unless being overwritten in your template */
	serviceName: packageMetadata.name,
	serviceDescription: packageMetadata.description,
	dnsName: packageMetadata.name.toLowerCase()
};
deployTemplate(stackTemplate, stackConfiguration, parameters) {...}

// Deploy the stage of your microservice stack, to be called for each build in master or a pull-request.
publishAndDeployStagePromise(options) {
  // options.stage
  // options.functionName
  // options.deploymentBucketName
  // options.deploymentKeyName
}

// Removes a deployed stage, to be used on pull-request created stages (API gateway has a limit fo 5 stages)
removeStagePromise(stage) {...}

// Creates a website, see below
publishWebsite(version, options) {...}

// Debug the running service on port at http://localhost:port/api
run(port, logger) {...}

```

#### S3 Website Deployment
AWS Architect has the ability to set up and configure an S3 bucket for static website hosting. It provides a mechanism as well to deploy your content files directly to S3.
Specify `bucket` in the configuration options for `contentOptions`, and configure the `PublishWebsite` function in the make.js file.

```javascript
	awsArchitect.publishWebsite('deadc0de-1', options)
	.then((result) => console.log(`${JSON.stringify(result, null, 2)}`))
	.catch((failure) => console.log(`Failed to upload website ${failure} - ${JSON.stringify(failure, null, 2)}`));

	awsArchitect.promoteToStage('deadc0de-1', 'production')
	.then((result) => console.log(`${JSON.stringify(result, null, 2)}`))
	.catch((failure) => console.log(`Failed copying stage to production ${failure} - ${JSON.stringify(failure, null, 2)}`));
```

##### Website publish options
Publishing the website has an `options` object which defaults to:
```
{	
	// provide overrides for paths to change bucket cache control policy, default 600 seconds,
	cacheControlRegexMap: {
		'index.html': 'public, max-age=10',
		default: 'public, max-age=600'
	}
}
```
## Built-in functionality

* Standardize CF template to deploy microservice to Lambda, API Gateway, Route 53, etc..
* Standardize CF template for S3 bucket hosting for a website
* Default configuration to automatically handle the creation of pull request deployments to test infrastructure before production
* Working templated sample and make.js file to run locally and CI build.
* Lambda/API Gateway setup for seemless integration.
* Automatic creation of AWS resources when using including:
	* Lambda functions
	* API Gateway resources
	* Environments for managing resources in AWS
	* S3 Buckets and directorys
	* S3 static website hosting
* Developer testing platform, to run lambdas and static content as a local express Node.js service, to test locally.

### Service Configuration
See [template service documentation](./bin/template/README.md) for how individual parts of the service are configured.

## Also

### AWS Documentation

* [Lambda](http://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/Lambda.html)
* [Node SDK](http://docs.aws.amazon.com/AWSJavaScriptSDK/guide/node-configuring.html)
