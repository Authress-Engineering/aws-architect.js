#!/usr/bin/env node
'use strict';

var fs = require('fs');
var glob = require('glob');
var path = require('path');

function BucketManager(s3Manager, bucket) {
	this.S3Manager = s3Manager;
	this.Bucket = bucket ? bucket : null;
} 

BucketManager.prototype.EnsureBucket = function(serviceTag, region){
	return this.S3Manager.headBucket({ Bucket: this.Bucket }).promise()
	.catch(data => {
		if(data.code !== 'NotFound') {
			throw ({ Title: 'Bucket already exists, but you do not have access to it.', Error: data.stack || data.toString(), Details: data });
		}
		var params = {
			Bucket: this.Bucket
		};
		if(!region.match('us-east-1')) {
			params.CreateBucketConfiguration = {
				LocationConstraint: region
			};
		}
		return this.S3Manager.createBucket(params).promise()
		.catch(data => {
			switch (data.code) {
				case 'AccessDenied':
					throw ({ Title: 'Access Denied to bucket, check user role permissions.', BucketName: this.Bucket });
				case 'Forbidden':
					throw ({ Title: 'Bucket already exists in another account.', BucketName: this.Bucket });
				case 'InvalidBucketName':
					throw ({ Title: 'Invalid Bucket Name', BucketName: this.Bucket, Details: 'http://docs.aws.amazon.com/AmazonS3/latest/dev/BucketRestrictions.html'});
				default:
					throw ({ Title: 'AWS error creating bucket', Error: data.stack || data.toString(), Details: data });
			}
		});
	})
	.then(() => {
		return this.S3Manager.putBucketPolicy({
			Bucket: this.Bucket,
			Policy: JSON.stringify({
				"Version": "2012-10-17",
				"Statement": [
					{
						"Effect": "Allow",
						"Principal": "*",
						"Action": "s3:GetObject",
						"Resource": `arn:aws:s3:::${this.Bucket}/*`
					}
				]
			})
		}).promise();
	})
	.then(() => {
		return this.S3Manager.waitFor('bucketExists', {Bucket: this.Bucket}).promise();
	})
	.then(() => {
		var bucketTaggingPromise = this.S3Manager.putBucketTagging({
			Bucket: this.Bucket,
			Tagging: {
				TagSet: [
					{
						Key: 'Service',
						Value: serviceTag
					}
				]
			}
		}).promise();

		var bucketWebsitePromise = this.S3Manager.putBucketWebsite({
			Bucket: this.Bucket,
			WebsiteConfiguration: {
				IndexDocument: {
					Suffix: 'index.html'
				},
				ErrorDocument: {
					Key: 'error.html'
				}
			}
		}).promise();
		return Promise.all([bucketTaggingPromise, bucketWebsitePromise]);
	});
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
BucketManager.prototype.Deploy = function(contentPath, version, cacheControlRegexMap = {}) {
	console.log('Deploying Website');
	return new Promise((s, f) => {
		glob(path.join(contentPath, '**/*.*'), {nonull:true}, (error, list) => error ?
			f({ Title: 'Failed to get list of content files', Error: error.stack || error.toString(), Detail: error}) : s(list)); })
	.then(list => {
		return list.reduce((listPromise, file) => {
			return listPromise.then(list => {
				var relativePath = path.relative(path.resolve(contentPath), path.resolve(file));
				return this.S3Manager.putObject({
					Bucket: this.Bucket,
					Key: path.join(version, relativePath),
					Body: fs.createReadStream(file),
					ContentType: contentTypeMapping[path.extname(file)] || 'text/plain',
					CacheControl: cacheControlRegexMap[relativePath] || 'public, max-age=600'
				}).promise()
				.then(() => { console.log(`====> ${file}`); })
				.catch(failure => Promise.reject({File: file, Error: failure.stack || failure.toString(), Detail: failure}));
			});
		}, Promise.resolve())
		.then(result => {
			return { Title: 'Upload Success.', Bucket: this.Bucket, Version: version };
		});
	});
}

BucketManager.prototype.DeployLambdaPromise = function(bucket, localPath, remotePath) {
	return this.S3Manager.putObject({
		Bucket: bucket || this.Bucket,
		Key: remotePath,
		Body: fs.createReadStream(localPath),
		ContentType: 'application/zip',
		CacheControl: 'public, max-age=10'
	}).promise()
	.then(() => { console.log(`====> ${remotePath}`); })
	.catch(failure => {
		throw {File: localPath, Error: failure.stack || failure.toString(), Detail: failure};
	});
}

BucketManager.prototype.CopyBucket = function(source, target) {
	var listParams = {
		Bucket: this.Bucket,
		Delimiter: ',',
		EncodingType: 'url',
		//FetchOwner: true || false,
		//MaxKeys: 0
		Prefix: source
	};
	return this.S3Manager.listObjectsV2(listParams).promise()
	.then(data => {
		if(data.IsTruncated) { throw ({Title: 'Failed to copy source', Error: 'Too many objects present.' }); }
		return data.Contents.map(item => item.Key).filter(key => !key.match(/\/$/)).reduce((listPromise, key) => {
			return listPromise.then(list => {
				return this.S3Manager.copyObject({
					Bucket: this.Bucket,
					Key: path.join(target, path.relative(source, key)),
					CopySource: `${this.Bucket}/${key}`
				}).promise()
				.catch(failure => Promise.reject({Source: key, Error: failure.stack || failure.toString(), Detail: failure}));
			}).then(() => Promise.resolve({Title: 'Promote to stage success', Bucket: this.Bucket, Source: source, Target: target}))
		}, Promise.resolve([]));
	});
};
module.exports = BucketManager;