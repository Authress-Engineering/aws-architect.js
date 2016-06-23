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

#### API Sample

```javascript
	var aws = require('aws-sdk');
	var Api = require('node-openapi-factory');

	var api = new Api({
		description: 'This is the description of the lambda function',
		regions: ['us-east-1'],
		role: 'LAMBDA_EXECUTION_IAM_ROLE',
		runtime: 'nodejs4.3',
		memorySize: 128,
		publish: true,
		timeout: 3
	}, __filename);

	module.exports = api;

	api.get('/sample', (request) => {
		return {'Value': 1};
	});
```

##### Set a custom authorizer

```json
	api.Authorizer((authorizationToken, methodArn, principalId) => {
		return {
			principalId: principalId,
			policyDocument: {
				Version: '2012-10-17',
				Statement: [
					{
						Action: 'execute-api:Invoke',
						Effect: 'Deny',
						Resource: methodArn
					}
				]
			}
		}
	});
```

## Built-in functionality (What `AWS-Architect` does for you?)

* Authorization flow created in index.html for the website
* conventioned based static S3 website using the `/content` directory
* conventioned based lambda functions specified as an argument to the associated functions.
* Lambda/API Gateway setup for seemless integration.
* Automatically packages the necessary files into .tar.gz for S3 publishing.
* Automatic creation of AWS resources when using `AwsArchitect.PublishPromise()`. Including:
	* S3 static website (updates static content, and sets up bucket for website hosting.)
	* Lambda functions
	* API Gateway resources
	* IAM User and Service Roles
	* IdentityPool setup and configuration in Cognito
	* Environments for managing resources in AWS
	* DynamoDB tables used by service, and management with environments
* Local user testing platform, to run lambdas and static content as a local Node.js service.

### Service Configuration
See [template service documentation](./bin/template/README.md) for how individual parts of the service are configured.

## One-time Setup

* Create a Role of API Gateway to create API CloudWatch Logs `ApiGatewayServiceRole`
	* Policy: `AmazonAPIGatewayPushToCloudWatchLogs`
	* Trust
	```json
	{
		"Version": "2012-10-17",
		"Statement": [
			{
				"Sid": "",
				"Effect": "Allow",
				"Principal": {
					"Service": "apigateway.amazonaws.com"
				},
				"Action": "sts:AssumeRole"
			}
		]
	}
	```
	* Assign role to API Gateway

## Setup

* Create a security policy to use for the local user testing and for the AWS Role
* Create a role for your AWS Lambda's

### Architect Execution Steps
Architect creates new lambda functions and API Gateway resources according to the following conventions:

* Create ServiceRole to execute Lambda functions as, this may not be needed if the authentication is passed through API gateway.  Should have access to the DynamoDB, S3, and necessary services.
* Create the necessary DynamoDB tables
* Create Lambda Functions (Source from lambda files)
	* First time: Allow API Gateway to access lambda function using [aws sdk](http://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/Lambda.html#addPermission-property) or Commandline
	```
	aws lambda add-permission \
		--region us-west-2 \
		--function-name helloworld \
		--statement-id 5 \
		--principal apigateway.amazonaws.com \
		--action lambda:InvokeFunction \
		--source-arn arn:aws:execute-api:region:account-id:api-id/stage/method/resource-path" \
		--profile adminuser

	aws lambda get-policy \
		--function-name example \
		--profile adminuser
	```
* Create API Gateway Resource request with Lambda function (Source from lambda files):
	* Authorization: AWS_IAM
	* Invoke with Caller Credentials: true
	* Add Integration Request for Content-Type 'application/json': `Method Request passthrough` template and `When there are no templates defined (recommended)`.  [Set up a standard parser, and validation in the lambda function]
	* Add Method Response For all HTTP Codes
		* Headers: `Access-Control-Allow-Origin`
	* Add Integration Responses For all HTTP Codes which map: `.*"statusCode":HTTP_STATUS_CODE.*` to `HTTP_STATUS_CODE`.
		* For each have Body-Mapping Template set to be `$input.path('$.errorMessage')`
		* `Access-Control-Allow-Origin`: `'http://localhost'`
	* Add CORS setup
		* Add OPTIONS Verb:
			* Auth: None
			* Mock Integration
			* Method Response:
				* `200`
				* Headers:
					* Access-Control-Allow-Headers	
					* Access-Control-Allow-Origin	
					* Access-Control-Allow-Credentials	
					* Access-Control-Allow-Methods
			* Response Integration: - `200`:
				* Access-Control-Allow-Headers	'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token'
				* Access-Control-Allow-Origin	'http://localhost'	
				* Access-Control-Allow-Credentials	'true'	
				* Access-Control-Allow-Methods	'GET,PUT,POST,PATCH,DELETE,HEAD,OPTIONS'
	* Link the lambda functions to the API Gateway resources.
	* Automatically deploy to production
* Create S3 bucket and upload static files from the content directory.
	* Set permissions to be global for use as a website.
		```json
		{
			"Version":"2012-10-17",
			"Statement":[
				{
					"Sid":"AddPerm",
					"Effect":"Allow",
					"Principal": "*",
					"Action":["s3:GetObject"],
					"Resource":["arn:aws:s3:::BUCKET_NAME/*"]
				}
			]
		}
		```
	* Set hostname on DNS if specified in the `aws-config.json`

#### Also

* Yes all lambda funciton returns contain `{ ErrorMessage: 'result'}`.	That is because AWS still doesn't allow passing anything other than an envelop back to API Gateway.	Don't let the `ErrorMessage` part bother you.	Instead it might as well say `LambdaReturnJson`.

### Authentication
After finding the provider you are interested in using and integrating that into the static content don'tforget to prevent access to the identity pool in the Web Federated Authorization Provider.

## Additional Information

### Authorization Flow used by AWS-Architect microservices

* Each Login Attempt:
	* User clicks the login (or website checks to see if authorization has already occured automatically) for the specific Web Federation (Google, Twitter, etc...) and is directed to a login prompt.
	* Successful login redirects the user back to your site (or wherever your redirect url specifies.)
	* Take the response access_token (id_token), and send it Cognito to receive user credentials, receive back IdentityId.
	* Using the AWS Credentials get AWS IAM role to call API Gateway.
* Logout
	* REST API call to the Web Federated service to revoke the refresh token. `GET https://accounts.google.com/o/oauth2/revoke?token=REFRESH_TOKEN`

## FAQs

* Do I need to have `/login`?:
	* Do we take the google federated login token, pass it to the back end and instead of doing validation on it on every request, pass it to `/login`.	Login in would validate the token and then return Cognito AWS credentials, isn't that the point of Cognito, can that happen directly from the browser? Yes it can.	The browser will automatically get login credentials from the Web Federated provider, or ask the user to login again.	From there, just take the response access_code or id_token and reauthenticate against cognito.
* Shouldn't Cognito IDs expire, what happens if someone else gets by Cognito ID?
	* That means they can bypass the login to my provider, and instead log directly into AWS service using my Cognito ID.	Or they can log in with theirs, and then use mine to get my user data.	Can A request like this really be done?	Or does the credentials being set have to match the call to the Cognito Sync. So questions [and Answers](http://stackoverflow.com/questions/36685734/what-does-aws-cognitosync-listdatasets-require-identityid):
* Why use the IAM login, it seems like unneccesary authentication?
	* It is, since the service could be public instead, but this way guarantees user authentication against AWS API Gateway resources.	Instead of relying on the user sending the IdentityId, auth can pull this information out the request.	And without AWS credentials, the service could be the target of a DoS attack.  There is an additional benefit of ignoring API Gateway altogether if your service doesn't need to public, less infrastructure => Yay!

### AWS Documentation

* [Lambda](http://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/Lambda.html)
* [Node SDK](http://docs.aws.amazon.com/AWSJavaScriptSDK/guide/node-configuring.html)

### Future Features

* [Use Lambda alias for API Gateway versions](https://aws.amazon.com/blogs/compute/using-api-gateway-stage-variables-to-manage-lambda-functions/)
* Set up Cloudfront for the Bucket so that caching happens using edge locations.

#### Setup Build Server for microservice management `auto`
This will configure your aws account to allow your build system to automatically deploy to AWS.	It does this by creating a deployer role, which will have access to modifying the necessary resources.

#### Do all necessary setup defaults `full`
This will complete all of the actions necessary to design, manage, and use a new microservice. This will run `init` and `auto`.

### Discovery Documents
Links should not be hardcoded to providers, but instead use the discovery documents specified at [Google](https://accounts.google.com/.well-known/openid-configuration).
