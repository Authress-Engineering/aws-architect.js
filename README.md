# AWS Architect

A hardened orchestrator for deploying Lambda microservices and S3 backed websites to AWS, using best practices, and an SDK that handles every possible edge case, with a focus on **safety**.

This is an open source project managed by the [Authress Engineering team](https://authress.io).

<p align="center">
    <a href="https://authress.io" alt="Authress Engineering">
      <img src="https://img.shields.io/static/v1?label=Authress+Engineering&message=OpenAPI%20Explorer&color=%23FBAF0B&logo=androidauto&logoColor=%23FBAF0B"></a>
    <a href="./LICENSE" alt="apache 2.0 license">
      <img src="https://img.shields.io/badge/license-Apache%202.0-blue.svg"></a>
    <a href="https://badge.fury.io/js/aws-architect" alt="npm version">
        <img src="https://badge.fury.io/js/aws-architect.svg"></a>
    <a href="https://authress.io/community" alt="npm version">
      <img src="https://img.shields.io/badge/community-Discord-purple.svg"></a>
</p>

## Features

* Standardized CF template to deploy microservice to Lambda, API Gateway, Route 53, etc..
* Standardized CF template for S3 bucket hosting for a website
* Default configuration to automatically handle the creation of pull request deployments to test infrastructure before production
* Working templated sample and make.js file to run locally and CI build.
* Lambda/API Gateway setup for seamless integration.
* Automatic creation of AWS resources when using including:
  * Lambda functions
  * API Gateway resources
  * Environments for managing resources in AWS
  * S3 Buckets and directories
  * S3 static website hosting
* Developer testing platform, to run lambdas and static content as a local express Node.js service, to test locally. Integrates with [OpenAPI-Factory](https://github.com/Authress-Engineering/openapi-factory.js#readme)

## Usage

### Library Functions

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

// Validate a cloud formation stack template using CloudFormation
validateTemplate(stackTemplate) {...}

// Deploy a Cloudformation template to AWS, should be used to create all the infrastructure required and run only on master branches
let stackConfiguration = {
  stackName: 'STACK_NAME'
  changeSetName: 'NAME_OF_CHANGE_SET'
};
let parameters = { /** PARAMETERS_FOR_YOUR_TEMPLATE, but also include these unless being overwritten in your template */
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

// Deploy just a new version of a lambda function
deployLambdaFunctionVersion(options) {
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

### Example: S3 Website Deployment
AWS Architect has the ability to set up and configure an S3 bucket for static website hosting. It provides a mechanism as well to deploy your content files directly to S3.
Specify `bucket` in the configuration options for `contentOptions`, and configure the `PublishWebsite` function in the make.js file.

```javascript
  awsArchitect.publishWebsite('deadc0de-1', options)
  .then((result) => console.log(`${JSON.stringify(result, null, 2)}`))
  .catch((failure) => console.log(`Failed to upload website ${failure} - ${JSON.stringify(failure, null, 2)}`));

  .promoteToStage('deadc0de-1', 'production')
  .then((result) => console.log(`${JSON.stringify(result, null, 2)}`))
  .catch((failure) => console.log(`Failed copying stage to production ${failure} - ${JSON.stringify(failure, null, 2)}`));
```

Configuration Options: Publishing the website has an `options` object which defaults to:
```js
{
  // provide overrides for paths to change bucket cache control policy, default 600 seconds,
  cacheControlRegexMap: [
    { regex: '/index.html/', value: 'public, max-age=10' },
    { explicit: 'only.this.static.file', value: 'public, max-age=10' }
    { value: 'public, max-age=600' }
  ]
}
```

### CLI: Creating a microservice: `init`
This will also configure your aws account to allow your build system to automatically deploy to AWS. Run locally

* Create git repository and clone locally
* `npm install aws-architect -g`
* `aws-architect init`
* `npm install`
* Update:
  * `package.json`: package name, the package name is used to name your resources
  * `make.js`: Deployment bucket, Resource, and DNS name parameters which are used for CF deployment


## Built-in SAM and CFN templates:
See [template service documentation](./bin/template/README.md) for how individual parts of the service are configured.

## Also

### AWS Documentation

* [Lambda](http://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/Lambda.html)
* [Node SDK](http://docs.aws.amazon.com/AWSJavaScriptSDK/guide/node-configuring.html)
