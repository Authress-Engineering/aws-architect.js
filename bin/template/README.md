# AWS Microservice package
This is a Node based lambda microservice package created by AWS-Architect.

## Recent Changes
Visit the [changelog](CHANGELOG.md).

## Prerequisites

* Install NodeJS (4.3 this is what lambda uses) & npm
  ```bash
  curl -sL https://deb.nodesource.com/setup_4.x | sudo -E bash -
  sudo apt-get install -y nodejs
  ```
* Your user will need access to the following resources (or the continuously deployment user):
	* Development time resources (identical for deployment CI), [example security policy](../deployment-policy.json)
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
  	node make.js
  ```

### Running server locally
AWS Architect uses [OpenAPI Factory](https://github.com/wparad/openapi-factory.js) to convert the `src/index.js` into a node server API used by `node-express`.  This can be loaded, and the server can be started by running

```bash
   npm install
   node make.js run
```

### Deploying to AWS

	* Using the built in make.js file

```bash
	npm install
	node make.js deploy
```
	* Configure awsArchitect

```javascript
	var packageMetadataFile = path.join(__dirname, 'package.json');
	var packageMetadata = require(packageMetadataFile);

	var apiOptions = {
		sourceDirectory: path.join(__dirname, 'src'),
		description: 'This is the description of the lambda function',
		regions: ['us-east-1'],
		//role: 'optional-role-override',
		runtime: 'nodejs4.3',
		memorySize: 128,
		publish: true,
		timeout: 3,
		securityGroupIds: [],
		subnetIds: []
	};
	var contentOptions = {
		bucket: 'WEBSITE_BUCKET_NAME',
		contentDirectory: path.join(__dirname, 'content')
	};
	var awsArchitect = new AwsArchitect(packageMetadata, apiOptions, contentOptions);
```

### Setup

#### Setting up Google authentication, Cognito, and API Gateway

* Create a project in Google: https://console.developers.google.com/project
	* Enable and Manage API's
	* Credentials: OAuth 2.0 and Client IDs: Create a new client id, and use this in the later steps.	You will have to set up the redirects to actually work on login successes
* Create a new Identity pool to associate with the application (save the IdentityPoolId)
	* Add in the google client to the IdentityPool
* [Optional: used for non-REST Lambdas] Create a UserRole, set it to have access to API Gateway and Cognito Sync using the IdentityPoolId
	* Set the Trust Policy to be (based on [Amazon Docs](http://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_create_for-idp_oidc.html)):
		* [example trust policy](../userrole-trust-relationship.json)
	* Set the permission policy to be [example user role permissions](../userrole-policy.json)
* Create a Service Role, to have access to the back end AWS needed resources: [example service user permissions](../service-policy.json) and [example trust relationship](../service-trust-relationship.json).
* `content/index.html`:
	* Update google usercontent token (`google-signin-client_id`) in the index.html with client id.
	* Update `IDENTITY_POOL_ID` with the identityPoolId

TL;DL

* Static content => `content/index.html`
* Lambda function => `src/index.js`