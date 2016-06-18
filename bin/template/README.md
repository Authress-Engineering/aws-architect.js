# AWS Microservice package
This is a Node based lambda microservice package created by AWS-Architect.

## Recent Changes
Visit the [changelog](CHANGELOG.md).

## Prerequisites

* Install NodeJS & npm

	```bash
		curl -sL https://deb.nodesource.com/setup_4.x | sudo -E bash -
		sudo apt-get install -y nodejs
	```
* Install and configure the [AWSCLI](http://docs.aws.amazon.com/cli/latest/userguide/installing.html).
* Your user will need access to the following resources (or the continuously deployment user):
	* Development time resources (identical for deployment CI), [example security policy](./bin/deployment-policy.json)
	* Service runtime resources (for testing only, not required, execute lambda, api gateway access, etc...)

## Development
Development is templated using the make.js file. All the needed actions are present there. For ease, the AWS Architect to managed as a npm package. So all functionality is available directly from native nodejs, no having to write shell scripts just do some simple development.

* Website is created from the content directory.
* Lambda functions are created from the `src/index.js` source.
* `npm install`: Install necessary dependencies.
* `node make.js` or `node make.js build`: Builds and run unit tests.
* `sudo npm start`: Runs the microservice locally, it inhabits the api and lambda functions using nodejs express.
* `node make.js deploy`: Deploys the package to AWS.

### Building

	```bash
		npm install
		npm make.js
	```
### Running server locally
AWS Architect uses [OpenAPI Factory]() to convert the `src/index.js` into a node server API used by `node-express`.  This can be loaded, and the server can be started by running

	```bash
		npm install
		npm make.js run
	```
### Deploying to AWS

	```bash
		npm install
		npm make.js deploy
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

TL;DL

* Static content => `content/index.html`
* Lambda functions => `src/index.js`