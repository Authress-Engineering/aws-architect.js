# AWS Microservice package
This is a Node based lambda microservic package created by AWS-Architect.

## Recent Changes
Visit the [changelog](CHANGELOG.md).

## Development

### Prerequisites

* Install NodeJS & npm

	```bash
		curl -sL https://deb.nodesource.com/setup_5.x | sudo -E bash -
		sudo apt-get install -y nodejs
	```
* Install and configure the [AWSCLI](http://docs.aws.amazon.com/cli/latest/userguide/installing.html).
* Your user will need access to the following resources (or the continuously deployment user):
	* Development time resources (identical for deployment CI)
		```json
		{
			"Version": "2012-10-17",
			"Statement": [
				{
					"Effect": "Allow",
					"Action": "iam:*",
					"Resource": "*"
				},
				{
					"Effect": "Allow",
					"Action": "lambda:*",
					"Resource": "*"
				},
				{
					"Effect": "Allow",
					"Action": "dynamoDB:*",
					"Resource": "*"
				},
				{
					"Effect": "Allow",
					"Action": "apigateway:*",
					"Resource": "*"
				}
			]
		}
		```
	* Service runtime resources (for testing only, not required, execute lambda, api gateway access, etc...)

* Run the microservice locally, depending on the use of aws-sdk may write to dynamoDB tables directly.	Check for the local flag in the context.

	```bash
		npm install
		npm make.js
		sudo npm start
	```

### Setup

#### Setting up Google authentication, Cognito, and API Gateway

* Create a project in Google: https://console.developers.google.com/project
	* Enable and Manage API's
	* Credentials: OAuth 2.0 and Client IDs: Create a new client id, and use this in the later steps.	You will have to set up the redirects to actually work on login successes
* Create a new Identity pool to associate with the application (save the IdentityPoolId)
	* Add in the google client to the IdentityPool
* Create a UserRole, set it to have access to API Gateway and Cognito Sync using the IdentityPoolId
	* Set the Trust Policy to be (based on [Amazon Docs](http://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_create_for-idp_oidc.html)):
		```json
		{
			"Version": "2012-10-17",
			"Statement": [
				{
					"Effect": "Allow",
					"Principal": {
						"Federated": "cognito-identity.amazonaws.com"
					},
					"Action": "sts:AssumeRoleWithWebIdentity",
					"Condition": {
						"StringEquals": {
							"cognito-identity.amazonaws.com:aud": "IDENTITY_POOL_ID"
						},
						"ForAnyValue:StringLike": {
							"cognito-identity.amazonaws.com:amr": "authenticated"
						}
					}
				}
			]
		}
		```
	* Set the permission policy to be (Depending on the security model, it is possible to allow multiple levels, i.e. use a gateway.):
		```json
		{
			"Version": "2012-10-17",
			"Statement": [
				{
					"Effect": "Allow",
					"Action": [
						"execute-api:Invoke"
					],
					"Resource": [
						"arn:aws:execute-api:*:*:API_ID/production/*"
					]
				},
				{
					"Effect": "Allow",
					"Action": [
						"lambda:InvokeFunction"
					],
					"Resource": [
						"arn:aws:lambda:*:*:*:API_NAME_*"
					]
				},
			]
		}
		```
* Create a ServiceRole, to have access to the back end AWS needed resources:
	```json
	{
		"Version": "2012-10-17",
		"Statement": [
			{
				"Resource": "arn:aws:dynamodb:*:*:table/*.SERVICE_IDENTIFIER.*",
				"Action": [
					"dynamodb:DeleteItem",
					"dynamodb:GetItem",
					"dynamodb:PutItem",
					"dynamodb:Query",
					"dynamodb:Scan",
					"dynamodb:UpdateItem"
				],
				"Effect": "Allow"
			},
			{
				"Resource": "arn:aws:logs:*:*:*",
				"Action": [
					"logs:CreateLogGroup",
					"logs:CreateLogStream",
					"logs:PutLogEvents"
				],
				"Effect": "Allow"
			}
		]
	}
	```
* `content/index.html`:
	* Update google usercontent token (`google-signin-client_id`) in the index.html with client id.
	* Update `IDENTITY_POOL_ID` with the identityPoolId
	* Set the redirect on auth to be the s3 bucket (so localhost and also the actual S3 bucket and optionally cloudfront)

## Development

* Website is created from the content directory.
* Lambda functions are created from the lambda directory
	* Each directory will create a lambda function with the same name as it.
	* When testing locally (using the builtin to run as a local service instead of lambda function), the handler will be assumed to be called index.js iside the directory.
	* Special directory called lib inside lambda directory which contains all shared code, non-shared lambda code goes in the handler directory.

TL;DL

* Static content => `content`
* Lambda functions => `lambda`
* Prevent code duplication with `lambda/lib`