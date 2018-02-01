'use strict';

/**
 * Module dependencies
 */
const fs = require('fs');
const path = require('path');
const aws = require('aws-sdk');
const commander = require('commander');
const AwsArchitect = require('aws-architect');

// aws.config.credentials = new aws.SharedIniFileCredentials({profile: 'default'});

let ci = require('ci-build-tools')(process.env.GIT_TAG_PUSHER);
let version = ci.GetVersion();
commander.version(version);

var packageMetadataFile = path.join(__dirname, 'package.json');
var packageMetadata = require(packageMetadataFile);

const deploymentBucket = 'master-deployment-artifacts-s3-bucket';
var apiOptions = {
	sourceDirectory: path.join(__dirname, 'src'),
	description: 'This is the description of the lambda function',
	regions: ['eu-west-1'],
	runtime: 'nodejs6.10',
	useCloudFormation: true,
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
.command('deploy')
.description('Deploy to AWS.')
.action(() => {
		console.log('Nothing to do here');
	});

commander
	.command('run')
	.description('Run lambda web service locally.')
	.action(() => {
		// default logger is console.log, if you want to override it, can be done here.
		let logger = logMessage => console.log(logMessage);
		awsArchitect.Run(8080, logger)
		.then((result) => console.log(JSON.stringify(result, null, 2)))
		.catch((failure) => console.log(JSON.stringify(failure, null, 2)));
	});

commander
	.command('deploy')
	.description('Deploy to AWS.')
	.action(() => {
		if (!process.env.CI_COMMIT_REF_SLUG) {
			console.log('Deployment should not be done locally.');
			return;
		}

		packageMetadata.version = version;
		fs.writeFileSync(packageMetadataFile, JSON.stringify(packageMetadata, null, 2));
	
		let awsArchitect = new AwsArchitect(packageMetadata, apiOptions);
		let stackTemplate = require('./cloudFormationServerlessTemplate.json');
		let cloudFormationPromise = awsArchitect.ValidateTemplate(stackTemplate);
		let isMasterBranch = process.env.CI_COMMIT_REF_SLUG === 'master';
		
		return cloudFormationPromise
		.then(() => {
			if (isMasterBranch === 'master') {
				return awsArchitect.PublishLambdaArtifactPromise({ bucket: deploymentBucket })
				.then(() => {
					let stackConfiguration = {
						changeSetName: `${process.env.CI_COMMIT_REF_SLUG}-${version || '1' }`,
						stackName: packageMetadata.name
					};
					let parameters = {
						serviceName: packageMetadata.name,
						serviceDescription: packageMetadata.description,
						deploymentBucketName: deploymentBucket,
						deploymentKeyName: `${packageMetadata.name}/${version}/lambda.zip`,
						dnsName: packageMetadata.name,
						hostedName: "toplevel.domain.io",
						amazonHostedZoneIdForService: 'AMAZON_HOST_ZONE_ID_FOR_DNS'
					};
					return awsArchitect.DeployTemplate(stackTemplate, stackConfiguration, parameters);
				});
			}
		})
		.then(() => {
			return awsArchitect.PublishAndDeployStagePromise({
				stage: isMasterBranch ? 'production' : process.env.CI_COMMIT_REF_SLUG,
				functionName: packageMetadata.name,
				deploymentBucketName: deploymentBucket,
				deploymentKeyName: `${packageMetadata.name}/${version}/lambda.zip`
			});
		})
		.then(result => {
			console.log(result);
		}, failure => {
			console.log(failure);
			process.exit(1);
		});
	});


commander
	.command('deploy')
	.description('Depling website to AWS.')
	.action(() => {
		if (!process.env.CI_COMMIT_SHA) {
			console.log('Deployment should not be done locally.');
			return;
		}
	
		let deploymentVersion = 'v1';
		let deploymentLocation = 'https://production.website.com/';
		
		let awsArchitect = new AwsArchitect(packageMetadata, apiOptions);
		let stackTemplate = require('./cloudFormationWebsiteTemplate.json');
		let cloudFormationPromise = awsArchitect.ValidateTemplate(stackTemplate);
		let isMasterBranch = process.env.CI_COMMIT_REF_SLUG === 'master';
	
		if (isMasterBranch) {
			let stackConfiguration = { stackName: 'STACK_NAME_FOR_WEBSITE' };
			cloudFormationPromise = cloudFormationPromise
			.then(() => {
				if (isMasterBranch) {
					let stackConfiguration = {
						changeSetName: `${process.env.CI_COMMIT_REF_SLUG}-${process.env.CI_PIPELINE_ID || '1' }`,
						stackName: packageMetadata.name
					};
					let parameters = {
						dnsName: packageMetadata.name,
						hostedName: 'domain_name',
						useRoot: 'true',
						// Manually create in US-EAST-1
						acmCertificateArn: 'ACM_CERTIFICATE_US_EAST_1'
					};
					return awsArchitect.DeployTemplate(stackTemplate, stackConfiguration, parameters);
				}
			});
		} else {
			deploymentVersion = `PR${version}`;
			deploymentLocation = `https://tst-web.website.com/${deploymentVersion}/index.html`;
		}
	
		cloudFormationPromise.then(() => awsArchitect.PublishWebsite(deploymentVersion, {
			configureBucket: false,
			cacheControlRegexMap: {
				'index.html': 600,
				default: 24 * 60 * 60
			}
		}))
		.then(result => console.log(`${JSON.stringify(result, null, 2)}`))
		.then(() => console.log(`Deployed to ${deploymentLocation}`))
		.catch(failure => {
			console.log(`Failed to upload website ${failure} - ${JSON.stringify(failure, null, 2)}`);
			process.exit(1);
		});
	});

commander
	.command('delete')
	.description('Delete Stage from AWS.')
	.action(() => {
		if (!process.env.CI_COMMIT_REF_SLUG) {
			console.log('Deployment should not be done locally.');
			return;
		}

		packageMetadata.version = version;
		fs.writeFileSync(packageMetadataFile, JSON.stringify(packageMetadata, null, 2));

		let awsArchitect = new AwsArchitect(packageMetadata, apiOptions);
		return awsArchitect.RemoveStagePromise(process.env.CI_COMMIT_REF_SLUG)
		.then(result => {
			console.log(result);
		}, failure => {
			console.log(failure);
			process.exit(1);
		});
	});

commander.on('*', () => {
	if(commander.args.join(' ') == 'tests/**/*.js') { return; }
	console.log('Unknown Command: ' + commander.args.join(' '));
	commander.help();
	process.exit(0);
});
commander.parse(process.argv[2] ? process.argv : process.argv.concat(['build']));