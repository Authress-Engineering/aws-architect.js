#!/usr/bin/env node
'use strict';

var https = require('https');
var aws = require('aws-sdk');
var request = require('request');

module.exports = BucketFactory;

function BucketFactory(host) {
  this.Host = host || 'https://s3.us-east-1.amazonaws.com';
} 

var s3BucketParams = {
	Bucket: 'BUCKET_NAME',
	ACL: 'public-read-write'
};
BucketFactory.prototype.Create = function(s3_bucket, s3_key, s3_object_version, name, role_arn){
  console.log('Creating Lambda');
  var s3 = new aws.S3({endpoint: 's3-us-east-1.amazonaws.com'});

	/*
		Set the Policy to restrict outside access:
		BUCKET_POLICY_TEMPLATE = """
		{
		    "Version": "2012-10-17",
		    "Statement": [
			{
			    "Sid": "AllowIPs",
			    "Effect": "Allow",
			    "Principal": "*",
			    "Action": "*",
			    "Resource": "arn:aws:s3:::%(bucket_name)s/*",
			    "Condition": {
				"IpAddress": {
				    "aws:SourceIp": [
					"myipaddresses"
				    ]
				}
			    }
			},
			{
			    "Sid": "DenyEveryoneElse",
			    "Effect": "Deny",
			    "Principal": "*",
			    "Action": "s3:*",
			    "Resource": "arn:aws:s3:::%(bucket_name)s/*",
			    "Condition": {
				"NotIpAddress": {
				    "aws:SourceIp": [
					"myipaddresses"
				    ]
				}
			    }
			}
		    ]
		}
		"""
	*/

	s3.headBucket(s3BucketParams, function(err, data) {
		if (err) {
	  		s3.createBucket(s3BucketParams, function(err, data) {
				if (err) { console.log(err, err.stack); }
				else { console.log('Created Bucket: ' + s3BucketParams.Bucket + ' - ' + data); }
			});
		}
	});
	s3.waitFor('bucketExists', {Bucket: s3BucketParams.Bucket}, function(err, data) {
		if (err) { console.log(err, err.stack); throw { type: "BucketWebsiteConfiguration", title: err, detail: err.stack}; }

		s3.putBucketTagging({
			Bucket: s3BucketParams.Bucket,
			Tagging: {
				TagSet: [
					{
						Key: 'Squad',
						Value: 'SquadName'
					}
				]
			}
		}, function(err, data) {
			if (err) { console.log(err, err.stack); throw { type: "BucketTagging", title: err, detail: err.stack}; }
			else { console.log(data); }
		});

		s3.putBucketWebsite({
			Bucket: s3BucketParams.Bucket,
			WebsiteConfiguration: {
				IndexDocument: {
					Suffix: 'index.html'
				},
				ErrorDocument: {
					Key: 'error.html'
				}
			}
		}, function(err, data) {
			if (err) { console.log(err, err.stack); throw { type: "BucketWebsiteConfiguration", title: err, detail: err.stack}; }
			else { console.log(data); }
		});
	});
}

BucketFactory.prototype.Publish() {
	console.log('Publish to AWS');
		glob("src/**/*.*", {nonull:true}, function (error, list) {
			if(error) { throw { type: 'LoadSrcFiles', title: "Failed to get source list", detail: error}; }

			for(var source_file of list) {
				(function(file) {
					console.log('Uploading file: ' + file);
					s3.putObject({
						Bucket: s3BucketParams.Bucket,
						Key: path.join(path.relative(path.resolve('src'), path.resolve(file))),
						Body: fs.createReadStream(file),
						CacheControl: 'public, max-age=86400'
					}, function(err, data) {
						if (err) { console.log(err, err.stack); throw { type: "DataUpload", title: err, detail: err.stack, instance: file}; }
						else { console.log('Uploaded file: ' + file + ' - ' + data); }
					});
				})(source_file);
			}
		});
}
//var l = new BucketFactory().Create();