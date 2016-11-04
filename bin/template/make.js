'use strict';

/**
 * Module dependencies
 */
var fs = require('fs');
var exec = require('child_process').execSync;
var execAsync = require('child_process').spawn;
var glob = require('glob');
var https = require('https');
var path = require('path');

var AwsArchitect = require('aws-architect');
var travis = require('travis-build-tools')(process.env.GIT_TAG_PUSHER);
var version = travis.GetVersion();
var commander = require('commander');
commander.version(version);

//Set default region to test with
var aws = require('aws-sdk');
aws.config.update({ region: 'us-east-1' });

var packageMetadataFile = path.join(__dirname, 'package.json');
var packageMetadata = require(packageMetadataFile);

var apiOptions = {
	sourceDirectory: path.join(__dirname, 'src'),
	description: 'This is the description of the lambda function',
	regions: ['us-east-1'],
	runtime: 'nodejs4.3',
	memorySize: 128,
	publish: true,
	timeout: 3,
	securityGroupIds: [],
	subnetIds: []
};
var contentOptions = {
	bucket: 'WEBSITE_BUCKET_NAME',
	contentDirectory: path.join(__dirname, 'content')
};
var awsArchitect = new AwsArchitect(packageMetadata, apiOptions, contentOptions);

commander
	.command('build')
	.description('Setup require build files for npm package.')
	.action(() => {
		packageMetadata.version = version;
		fs.writeFileSync(packageMetadataFile, JSON.stringify(packageMetadata, null, 2));

		console.log("Building package %s (%s)", packageMetadata.name, version);
		console.log('');

		console.log('Running tests')
		var test = exec('npm test');
		console.log(' ' + test);
	});

commander
	.command('run')
	.description('Run lambda web service locally.')
	.action(() => {
		awsArchitect.Run(8080)
		.then((result) => console.log(JSON.stringify(result, null, 2)))
		.catch((failure) => console.log(JSON.stringify(failure, null, 2)));
	});

commander
	.command('deploy')
	.description('Deploy to AWS.')
	.action(() => {
		var databaseSchema = [
			// {
			// 	TableName: 'User',
			// 	AttributeDefinitions: [{ AttributeName: 'UserId', AttributeType: 'S' }],
			// 	KeySchema: [{ AttributeName: 'UserId', KeyType: 'HASH' }],
			// 	ProvisionedThroughput: { ReadCapacityUnits: 1, WriteCapacityUnits: 1 }
			// }
		];
		awsArchitect.PublishAndDeployPromise(version, databaseSchema)
		.then((result) => console.log(`${JSON.stringify(result, null, 2)}`))
		.catch((failure) => console.log(`${failure.Details} - ${JSON.stringify(failure, null, 2)}`));

		// awsArchitect.PublishWebsite(version)
		// .then((result) => console.log(`${JSON.stringify(result, null, 2)}`))
		// .catch((failure) => console.log(`Failed to upload website ${failure} - ${JSON.stringify(failure, null, 2)}`));
	});

commander.on('*', () => {
	if(commander.args.join(' ') == 'tests/**/*.js') { return; }
	console.log('Unknown Command: ' + commander.args.join(' '));
	commander.help();
	process.exit(0);
});
commander.parse(process.argv[2] ? process.argv : process.argv.concat(['build']));