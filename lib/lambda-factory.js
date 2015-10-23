#!/usr/bin/env node
'use strict';

var https = require('https');
var aws = require('aws-sdk');
var request = require('request');

module.exports = LambdaFactory;

function LambdaFactory(host) {
  this.Host = host || 'https://apigateway.us-east-1.amazonaws.com';
} 

LambdaFactory.prototype.Create = function(s3_bucket, s3_key, s3_object_version, name, role_arn){
  console.log('Creating Lambda');
  if(name == null) { throw new {detail: 'name must be specified.'}; }
  if(role_arn == null) { throw new {detail: 'lambda role must be specified.'}; }
  var params = {
    Code: { /* required */
      S3Bucket: s3_bucket,
      S3Key: s3_key,
      S3ObjectVersion: s3_object_version
    },
    FunctionName: name || 'name', /* required */
    Handler: 'handler', /* required */
    Role: role_arn, /* required */
    Runtime: 'nodejs',
    Description: "Create by AWS-Architect: " + name,
    MemorySize: 128,
    Publish: true,
    Timeout: 3000
  };
  aws.config.update({
    accessKeyId: 'akid',
    secretAccessKey: 'secret',
    region: 'us-west-1'});
  aws.config.apiVersions = {
    lambda: '2015-03-31'
  };

  var lamdba = new aws.Lambda();
  //lambda.createFunction(params, function(err, data) {
  //  if (err) console.log(err, err.stack); // an error occurred
  //  else     console.log(data);           // successful response
  //});
}

//var l = new LambdaFactory().Create();