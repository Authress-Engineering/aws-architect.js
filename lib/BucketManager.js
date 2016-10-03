#!/usr/bin/env node
'use strict';

var fs = require('fs');
var glob = require('glob');
var path = require('path');

function BucketManager(s3Manager) {
  this.S3Manager = s3Manager;
} 

BucketManager.prototype.Create = function(s3_bucket, s3_key, s3_object_version, name, role_arn){
 //  var s3 = new aws.S3({endpoint: 's3-us-east-1.amazonaws.com'});

	// /*
	// 	Set the Policy to restrict outside access:
	// 	BUCKET_POLICY_TEMPLATE = """
	// 	{
	// 	    "Version": "2012-10-17",
	// 	    "Statement": [
	// 		{
	// 		    "Sid": "AllowIPs",
	// 		    "Effect": "Allow",
	// 		    "Principal": "*",
	// 		    "Action": "*",
	// 		    "Resource": "arn:aws:s3:::%(bucket_name)s/*",
	// 		    "Condition": {
	// 			"IpAddress": {
	// 			    "aws:SourceIp": [
	// 				"myipaddresses"
	// 			    ]
	// 			}
	// 		    }
	// 		},
	// 		{
	// 		    "Sid": "DenyEveryoneElse",
	// 		    "Effect": "Deny",
	// 		    "Principal": "*",
	// 		    "Action": "s3:*",
	// 		    "Resource": "arn:aws:s3:::%(bucket_name)s/*",
	// 		    "Condition": {
	// 			"NotIpAddress": {
	// 			    "aws:SourceIp": [
	// 				"myipaddresses"
	// 			    ]
	// 			}
	// 		    }
	// 		}
	// 	    ]
	// 	}
	// 	"""
	// */

	// s3.headBucket(s3BucketParams, function(err, data) {
	// 	if (err) {
	//   		s3.createBucket(s3BucketParams, function(err, data) {
	// 			if (err) { console.log(err, err.stack); }
	// 			else { console.log('Created Bucket: ' + s3BucketParams.Bucket + ' - ' + data); }
	// 		});
	// 	}
	// });
	// s3.waitFor('bucketExists', {Bucket: s3BucketParams.Bucket}, function(err, data) {
	// 	if (err) { console.log(err, err.stack); throw { type: "BucketWebsiteConfiguration", title: err, detail: err.stack}; }

	// 	s3.putBucketTagging({
	// 		Bucket: s3BucketParams.Bucket,
	// 		Tagging: {
	// 			TagSet: [
	// 				{
	// 					Key: 'Squad',
	// 					Value: 'SquadName'
	// 				}
	// 			]
	// 		}
	// 	}, function(err, data) {
	// 		if (err) { console.log(err, err.stack); throw { type: "BucketTagging", title: err, detail: err.stack}; }
	// 		else { console.log(data); }
	// 	});

	// 	s3.putBucketWebsite({
	// 		Bucket: s3BucketParams.Bucket,
	// 		WebsiteConfiguration: {
	// 			IndexDocument: {
	// 				Suffix: 'index.html'
	// 			},
	// 			ErrorDocument: {
	// 				Key: 'error.html'
	// 			}
	// 		}
	// 	}, function(err, data) {
	// 		if (err) { console.log(err, err.stack); throw { type: "BucketWebsiteConfiguration", title: err, detail: err.stack}; }
	// 		else { console.log(data); }
	// 	});
	// });
}

var contentTypeMapping = {
	'.html': 'text/html',
	'.json': 'application/json',
	'.css': 'text/css',
	'.js': 'application/javascript',
	'.ico': 'image/x-icon',
	'.svg': 'image/svg+xml',
	'.eot': 'application/vnd.ms-fontobject',
	'.ttf': 'application/font-sfnt',
	'.woff': 'application/font-woff',
	'.gif': 'image/gif',
};
BucketManager.prototype.Deploy = function(bucket, contentPath, version) {
	return new Promise((s, f) => {
		glob(path.join(contentPath, '**/*.*'), {nonull:true}, (error, list) => error ?
			f({ Title: 'Failed to get list of content files', Error: error.stack || error.toString(), Detail: error}) : s(list)); })
	.then(list => {
		return list.reduce((listPromise, file) => {
			return listPromise.then(list => {
				return this.S3Manager.putObject({
					Bucket: bucket,
					Key: path.join(version, path.relative(path.resolve(contentPath), path.resolve(file))),
					Body: fs.createReadStream(file),
					ContentType: contentTypeMapping[path.extname(file)] || 'text/plain',
					CacheControl: 'public, max-age=86400'
				}).promise()
				.catch(failure => Promise.reject({File: file, Error: failure.stack || failure.toString(), Detail: failure}));
			});
		}, Promise.resolve())
		.then(result => {
			return { Title: 'Upload Success.', Details: result };
		});
	});
}

module.exports = BucketManager;