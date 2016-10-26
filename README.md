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
	* `make.js`: AWS Lambda Role
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

#### Lambda with no API sample

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

### S3 Website Deployment

```javascript
	awsArchitect.PublishWebsite('bucket', 'deadc0de-1')
	.then((result) => console.log(`${JSON.stringify(result, null, 2)}`))
	.catch((failure) => console.log(`Failed to upload website ${failure} - ${JSON.stringify(failure, null, 2)}`));
````

## Built-in functionality

* Authorization flow created in index.html for the website (static content)
* conventioned based static S3 website using the `/content` directory
* conventioned based lambda functions specified as an argument to the associated functions.
* Lambda/API Gateway setup for seemless integration.
* Automatic creation of AWS resources when using `AwsArchitect.PublishPromise()`. Including:
	* Lambda functions
	* API Gateway resources
	* Environments for managing resources in AWS
* Local user testing platform, to run lambdas and static content as a local express Node.js service.

### Service Configuration
See [template service documentation](./bin/template/README.md) for how individual parts of the service are configured.

## Setup

### Manual one time setup
* Create a security policy to use for the local user testing and for the AWS Role
* Create a role for your AWS Lambda's: a ServiceRole to execute Lambda functions as. Should have access to the DynamoDB, S3, and necessary services.
* Create S3 bucket and upload static files from the content directory.
	* Set permissions to be global for use as a website.
	```json
	{
		"Version":"2012-10-17",
		"Statement":[
			{
				"Effect":"Allow",
				"Principal": "*",
				"Action":["s3:GetObject"],
				"Resource":["arn:aws:s3:::BUCKET_NAME/*"]
			}
		]
	}
	```

## Also

### Authentication
After finding the provider you are interested in using and integrating that into the static content don't forget to prevent access to the identity pool in the Web Federated Authorization Provider.

## Additional Information

### Authorization Flow used by AWS-Architect microservices
Authorization can either be done by a lambda authorizer or by cognito flow. Depending on the use case one may be preferred over the other. The question is whether or not the browser/s3 website is the only client. If they are use the cognito flow, if not then use the authorizer. An example of the authorizer is above, an example of the cognito frow is:

* Each Login Attempt (done in the index.html javascript code):
	* User clicks the login (or website checks to see if authorization has already occured automatically) for the specific Web Federation (Google, Twitter, etc...) and is directed to a login prompt.
	* Successful login redirects the user back to your site (or wherever your redirect url specifies.)
	* Take the response access_token (id_token), and send it Cognito to receive user credentials, receive back IdentityId.
	* Using the AWS Credentials get AWS IAM role to call API Gateway.
* Logout
	* REST API call to the Web Federated service to revoke the refresh token. `GET https://accounts.google.com/o/oauth2/revoke?token=REFRESH_TOKEN`

### AWS Documentation

* [Lambda](http://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/Lambda.html)
* [Node SDK](http://docs.aws.amazon.com/AWSJavaScriptSDK/guide/node-configuring.html)