# Change log
This is the changelog for [AWS Architect](readme.md).

## 5.0 ##
* Upgrade to OpenAPI-factory 3.0, see [openapi factory](https://github.com/wparad/openapi-factory.js/blob/master/CHANGELOG.md#30) for breaking changes.  This means that the authorizer now takes `event` and the authorization token must be manually extracted.
* Support authorizer resolution in express `server.run`

## 4.2 ##
* Include cloud formation deployment for standard resources.
* Added example cloud formation template to template service.
* New `RemoveStage` in AWS Architect.
* Add Support for `yarn.lock` files by assuming `yarn` should be executed.

## 4.1 ##
* Add `+AwsArchitect.prototype.PublishLambdaArtifactPromise` to perform the action to deploy a microservice zip package to S3.
* Allow specifying S3 artifacts cache-control times as overrides.

## 4.0 ##
* Removed passing the bucket as configuration into `PublishWebsite`.  Bucket is required as part of `contentOptions`.
* Prevent overwriting the bucket configuration using the `options` parameter in `PublishWebsite`.

## 3.7 ##
* Default to region set in aws config, rather than us-east-1.

## 3.6 ##
* Allow sending binary Buffer bodies via local server to match API Gateway functionality.

## 3.5 ##
* Upgrade default nodejs version to 6.10.

## 3.4 ##
* Upgrade jwt resolution to include by default RS256.

## 3.3 ##
* Remove CORS headers from local server.

## 3.2 ##
* Automatically create the service role to execute the lambda functions.
* Automatically create the s3 bucket with the website policy if it doesn't exist.

## 3.1 ##
* Moved website bucket configuration to contentOptions.
* Added `AwsArchitect.PromoteToStage(source, stage)` function which will copy a bucket directory.

## 3.0 ##
* Upgrade to handle ANY on aws resources.
* Allow running just a website on port 8080, without any extra api files.

## 2.1 ##
* Add support for creating dynamoDB Tables.
* Separate policy examples into their own documents.
* Allow specifying specific port to run on.
* Deploy content directory to s3.

## 2.0 ##
* All configuration is now contained in the api files. Generation, run, and testing is completed via index.js.  New templates created.
* A single lambda function is created, for the purpose of the whole microservice.
* Introduced configuration options for the api and content (s3).

## 1.1 ##
* Lambdas are not all specified in the file specified by the constructor call.  Default is the `src/index.js` file in `make.js`.  `aws-config.js` will be removed in version 2.0, and all configuration can be specified in the index.js composition root.

## 1.0 ##
* Introduced commandline ruby tool `aws-architect` for configuring a AWS Microservice instance using Cloud Formation and AWS API.
