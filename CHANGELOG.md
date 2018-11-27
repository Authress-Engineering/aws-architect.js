# Change log
This is the changelog for [AWS Architect](readme.md).

## 6.1 ##
* Deploy CF templates to S3 deployment bucket before deploying to CF to increase allow size of templates to 450KB.
* Allow cache control to be the full string, not just an number
* Dynamically inject `http` and `api` subpath into Location urls.
* `cacheControlRegexMap` supports array to keep order of regex mappings
* `deployTemplate` StackConfiguration `options` now accepts `automaticallyProtectStack` which defaults to be `true`, to protect stacks. This will only protect stacks which are successfully created.

## 6.0 ##
* Remove hosting index html, recommendation is to use nodemon and serve for that.
* Removed deprecated methods
* Now supports calling schedule and event triggers locally via the REST api.
* Nodejs8.10 by default
* Auto increment port starting at 8080 or specified up to 10 ports before falling back to a random port.
* Use `-`s in stage names instead of `_` so that more CIs can match their enviroments sligs correctl.
* Added default override for S3 content type uploads.
* Allow deploying `.files` using the `bucketManager`
* Dynamically inject `http` and `api` subpath into url hrefs.
* Remove autocreation of api gateway when attempting to find it. The expectation is that "searching for the API" happens always after the CF stack creation.
* `awsArchitect.run` now returns the `server` which contains the only method `stop` allowing manual shutdown.

## 5.1 ##
* Provide lower case names for methods.
* Add deprecation warning to removal methods in **6.0**.
* Index.html is uploaded last.
* Add in dynamic resolving of ACM certs by domain name.

## 5.0 ##
* Upgrade to OpenAPI-factory 3.0, see [openapi factory](https://github.com/wparad/openapi-factory.js/blob/master/CHANGELOG.md#30) for breaking changes.  This means that the authorizer now takes `event` and the authorization token must be manually extracted.
* Support authorizer resolution in express `server.run`
* Allow providing a custom logger to run function.

## 4.2 ##
* Include cloud formation deployment for standard resources.
* Added example cloud formation template to template service.
* New `RemoveStage` in AWS Architect.
* Add Support for `yarn.lock` files by assuming `yarn` should be executed.

## 4.1 ##
* Add `+AwsArchitect.prototype.publishLambdaArtifactPromise` to perform the action to deploy a microservice zip package to S3.
* Allow specifying S3 artifacts cache-control times as overrides.

## 4.0 ##
* Removed passing the bucket as configuration into `publishWebsite`.  Bucket is required as part of `contentOptions`.
* Prevent overwriting the bucket configuration using the `options` parameter in `publishWebsite`.

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
* Added `AwsArchitect.promoteToStage(source, stage)` function which will copy a bucket directory.

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
