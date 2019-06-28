# AWS Microservice package
This is a Node based lambda microservice package created by AWS-Architect.

## Recent Changes
Visit the [changelog](CHANGELOG.md).

## Prerequisites

* Install NodeJS (nodejs8.10 this is what lambda uses) & npm
  ```bash
  curl -sL https://deb.nodesource.com/setup_6.x | sudo -E bash -
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
* `npm run build` or `node make.js build`: Builds and run unit tests.
* `sudo npm start`: Runs the microservice locally, it inhabits the api and lambda functions using nodejs express.
* `npm run deploy`: Deploys the package to AWS.

### Building

  ```bash
    npm install
    npm run build
  ```

### Running server locally
AWS Architect uses [OpenAPI Factory](https://github.com/wparad/openapi-factory.js) to convert the `src/index.js` into a node server API used by `node-express`.  This can be loaded, and the server can be started by running

```bash
   npm install
   npm run start
```

### Deploying to AWS

#### Configure your make file with the necessary account information

* Using the built in make.js file

```bash
	npm install
	npm run deploy
```
	* Configure awsArchitect

```javascript
	let packageMetadataFile = path.join(__dirname, 'package.json');
	let packageMetadata = require(packageMetadataFile);

	let apiOptions = {
		sourceDirectory: path.join(__dirname, 'src'),
		description: 'This is the description of the lambda function',
		regions: ['us-east-1']
	};
	let contentOptions = {
		bucket: 'WEBSITE_BUCKET_NAME',
		contentDirectory: path.join(__dirname, 'content')
	};
	let awsArchitect = new AwsArchitect(packageMetadata, apiOptions, contentOptions);
```

#### First time setup
AWS Architect uses some CF macros that need to be deployed to CloudFormation. These exist to make your stacks simplier. To deploy them, run these two commands. You'll want to replace the two variables with an S3 bucket and AWS credentials profile (unless you want to use the default).

```sh
  npm install -g aws-architect-cf-macros
  aws-architect-cf-macros deploy TMP_DEPLOYMENT_BUCKET --profile PROFILE_NAME
```

### Setup

#### Permissions to invoke lambda functions
* From CloudWatch Rules:
```json
{
	"SourceAccount": { "Ref": "AWS::AccountId" },
	"SourceArn": {
		"Fn::Join": [
			"",
			[
				"arn:aws:events:",
				{ "Ref": "AWS::Region" },
				":",
				{ "Ref": "AWS::AccountId" },
				":rule",
				"/",
				{ "Ref": "serviceName" },
				"-*"
			]
		]
	}
}
```

* From CloudWatch Logs:
```json
{
	"SourceAccount": { "Ref": "AWS::AccountId" },
    "SourceArn": {
        "Fn::Join": [
			":",
            [
              "arn:aws:logs",
              { "Ref": "AWS::Region" },
              { "Ref": "AWS::AccountId" },
              "log-group",
              "*",
              "*"
            ]
        ]
	}
}
```

* From SES:
```json
{
	"SourceAccount": { "Ref": "AWS::AccountId" }
}
```

* From API Gateway:
```json
{
	"SourceAccount": { "Ref": "AWS::AccountId" },
	"SourceArn": {
		"Fn::Join": [
			"",
			[
				"arn:aws:execute-api:",
				{ "Ref": "AWS::Region" },
				":",
				{ "Ref": "AWS::AccountId" },
				":",
				{ "Ref": "ApiGateway" },
				"/*"
			]
		]
	}
}
```
