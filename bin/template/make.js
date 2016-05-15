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

var aws = require('aws-sdk');
aws.config.update({
	accessKeyId: process.env.AWS_ACCESS_KEY_ID,
	secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
	region: 'us-east-1'
});

var travis = require('travis-build-tools')(process.env.GIT_TAG_PUSHER);
var version = travis.GetVersion();
var commander = require('commander');
commander.version(version);

commander
	.command('build')
	.description('Setup require build files for npm package.')
	.action(function() {
		var package_metadata = require('./package.json');
		package_metadata.version = version;
		fs.writeFileSync('./package.json', JSON.stringify(package_metadata, null, 2));

		console.log("Building package %s (%s)", package_metadata.name, version);
		console.log('');

		console.log('Running tests')
		var test = exec('npm test');
		console.log(' ' + test);

		console.log('Packing the node service.')
		var pack = exec('npm pack');
		console.log(' ' + pack);
	});

commander
	.command('deploy')
	.description('Deploy to AWS.')
	.action(function() {
		var package_metadata = require('./package.json');
	});

commander.on('*', function() {
	if(commander.args.join(' ') == 'tests/**/*.js') { return; }
	console.log('Unknown Command: ' + commander.args.join(' '));
	commander.help();
	process.exit(0);
});
commander.parse(process.argv[2] ? process.argv : process.argv.concat(['build']));