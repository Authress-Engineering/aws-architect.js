#!/usr/bin/env node
'use strict';

var fs = require('fs');
var path = require('path');

function IamManager(iamFactory, bucket) {
	this.IamFactory = iamFactory;
} 

IamManager.prototype.EnsureServiceRole = function(roleName, packageName, bucketName){
	return this.IamFactory.listRoles({ MaxItems: 1000 }).promise()
	.then(data => {
		if(data.Roles.find(role => role.RoleName === roleName)) { return Promise.resolve(); }
		return this.IamFactory.createRole({
			RoleName: roleName,
			AssumeRolePolicyDocument: JSON.stringify({
				"Version": "2012-10-17",
				"Statement": [
					{
						"Effect": "Allow",
						"Principal": {
							"Service": "lambda.amazonaws.com"
						},
						"Action": "sts:AssumeRole"
					}
				]
			})
		}).promise();
	})
	.then(() => {
		return this.IamFactory.putRolePolicy({
			RoleName: roleName,
			PolicyName: 'AWS-Architect-Default-Service-Role-Policy',
			PolicyDocument: JSON.stringify({
				"Version": "2012-10-17",
				"Statement": [
					{
						"Action": [
							"dynamodb:DeleteItem",
							"dynamodb:GetItem",
							"dynamodb:PutItem",
							"dynamodb:Query",
							"dynamodb:Scan",
							"dynamodb:UpdateItem"
						],
						"Effect": "Allow",
						"Resource": `arn:aws:dynamodb:us-east-1:*:table/*.${packageName}.*`
					},
					{
						"Action": [
							"sns:*"
						],
						"Effect": "Allow",
						"Resource": `arn:aws:sns:us-east-1:*:app/*/${packageName}*`
					},
					{
						"Action": [
							"s3:*"
						],
						"Effect": "Allow",
						"Resource": `arn:aws:s3:::${bucketName || packageName}/*`
					},
					{
						"Effect": "Allow",
						"Resource": "arn:aws:logs:*:*:*",
						"Action": [
							"logs:CreateLogGroup",
							"logs:CreateLogStream",
							"logs:PutLogEvents"
						]
					}
				]
			})
		}).promise();
	})
	.catch(error => Promise.reject({Title: 'Failed to retrieve service role.', Error: error, Detail: error.stack}));
};

module.exports = IamManager;