# Change log
This is the changelog for [AWS Architect](readme.md).

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
