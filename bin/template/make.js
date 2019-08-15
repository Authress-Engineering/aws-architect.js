require('error-object-polyfill');
const path = require('path');
const commander = require('commander');
const aws = require('aws-sdk');
const AwsArchitect = require('aws-architect');

let ci = require('ci-build-tools')(process.env.GIT_TAG_PUSHER);
let version = ci.GetVersion();
commander.version(version);

let packageMetadataFile = path.join(__dirname, 'package.json');
let packageMetadata = require(packageMetadataFile);

let apiOptions = {
	deploymentBucket: 'master-deployment-artifacts-s3-bucket',
	sourceDirectory: path.join(__dirname, 'src'),
	description: `${packageMetadata.name}: ${packageMetadata.description}`,
	regions: ['eu-west-1']
};
let contentOptions = {
	bucket: 'WEBSITE_BUCKET_NAME',
	contentDirectory: path.join(__dirname, 'content')
};

commander
.command('run')
.description('Run lambda web service locally.')
.action(async () => {
	aws.config.credentials = new aws.SharedIniFileCredentials({ profile: 'default' });

	// default logger is console.log, if you want to override it, that can be done here.
	let logger = logMessage => console.log(logMessage);
	let awsArchitect = new AwsArchitect(packageMetadata, apiOptions, contentOptions);
	try {
		let result = await awsArchitect.run(8080, logger);
		console.log(result.title);

		// Manually stop the server
		await new Promise(resolve => setTimeout(resolve, 3000));
		await result.server.stop();
	} catch (failure) {
		console.error(failure);
	}
});

commander
.command('deploy')
.description('Deploy to AWS.')
.action(async () => {
	if (!process.env.CI_COMMIT_REF_SLUG) {
		console.log('Deployment should not be done locally.');
		return;
	}

	packageMetadata.version = version;

	let awsArchitect = new AwsArchitect(packageMetadata, apiOptions);
	let stackTemplate = require('./cloudFormationServerlessTemplate.json');
	let isMasterBranch = process.env.CI_COMMIT_REF_SLUG === 'master';

	try {
		let stackConfiguration = {
			changeSetName: `${process.env.CI_COMMIT_REF_SLUG}-${process.env.CI_PIPELINE_ID || '1'}`,
			stackName: packageMetadata.name,
			automaticallyProtectStack: true
		};
		await awsArchitect.validateTemplate(stackTemplate, stackConfiguration);
		await awsArchitect.publishLambdaArtifactPromise();
		if (isMasterBranch) {
			let parameters = {
				serviceName: packageMetadata.name,
				serviceDescription: packageMetadata.description,
				deploymentBucketName: apiOptions.deploymentBucket,
				deploymentKeyName: `${packageMetadata.name}/${version}/lambda.zip`,
				dnsName: packageMetadata.name.toLowerCase(),
				hostedName: 'toplevel.domain.io',
				useRoot: 'false'
			};
			await awsArchitect.deployTemplate(stackTemplate, stackConfiguration, parameters);
		}

		let publicResult = await awsArchitect.publishAndDeployStagePromise({
			stage: isMasterBranch ? 'production' : process.env.CI_COMMIT_REF_SLUG,
			functionName: packageMetadata.name,
			deploymentKeyName: `${packageMetadata.name}/${version}/lambda.zip`
		});

		console.log(publicResult);
	} catch (failure) {
		console.log(failure);
		process.exit(1);
	}
});

commander
.command('deploy-website')
.description('Depling website to AWS.')
.action(async () => {
	if (!process.env.CI_COMMIT_SHA) {
		console.log('Deployment should not be done locally.');
		return;
	}

	let deploymentVersion = 'v1';
	let deploymentLocation = 'https://production.website.com/';

	let awsArchitect = new AwsArchitect(packageMetadata, apiOptions, contentOptions);
	let stackTemplate = require('./cloudFormationWebsiteTemplate.json');
	let isMasterBranch = process.env.CI_COMMIT_REF_SLUG === 'master';

	try {
		let stackConfiguration = {
			changeSetName: `${process.env.CI_COMMIT_REF_SLUG}-${process.env.CI_PIPELINE_ID || '1'}`,
			stackName: packageMetadata.name,
			automaticallyProtectStack: true
		};
		await awsArchitect.validateTemplate(stackTemplate, stackConfiguration);
		if (isMasterBranch) {
			let parameters = {
				serviceName: 'example-service', // must result in a valid Lambda name; for example cannot contain "."
				dnsName: packageMetadata.name.toLowerCase(),
				hostedName: 'toplevel.domain.io',
				useRoot: 'true'
			};
			await awsArchitect.deployTemplate(stackTemplate, stackConfiguration, parameters);
		} else {
			deploymentVersion = `PR-${version}`;
			deploymentLocation = `https://tst-web.website.com/${deploymentVersion}/index.html`;
		}

		let result = await awsArchitect.publishWebsite(deploymentVersion, {
			cacheControlRegexMap: [
				{ regex: new RegExp(/index.html/), value: 'public, max-age=600' },
				{ explicit: 'manifest.json', value: 'public, max-age=600' },
				{ explicit: 'service-worker.js', value: 'public, max-age=600' },
				{ value: 'public, max-age=86400' }
			],
			contentTypeMappingOverride: {
				default: 'text/html'
			}
		});
		console.log(`Deployed to ${deploymentLocation}`, result);
	} catch (error) {
		console.log('Failed to upload website', error);
		process.exit(1);
	}
});

commander
.command('deploy-hosted-zone')
.description('Deploy hosted zone to AWS.')
.action(async () => {
	packageMetadata.version = version;

	let awsArchitect = new AwsArchitect(packageMetadata, apiOptions);
	let stackTemplate = require('./cloudFormationHostedZoneTemplate.json');

	try {
		let stackConfiguration = {
			changeSetName: `${process.env.CI_COMMIT_REF_SLUG}-${process.env.CI_PIPELINE_ID || '1'}`,
			stackName: `${packageMetadata.name}-hostedzone`,
			automaticallyProtectStack: true
		};
		await awsArchitect.validateTemplate(stackTemplate, stackConfiguration);
		let parameters = {
			hostedZoneName: '<your domain / hosted zone>'
		};
		let result = await awsArchitect.deployTemplate(stackTemplate, stackConfiguration, parameters);

		console.log(`Deploying hosted zone template resulted in ${result}.`);
	} catch (failure) {
		console.log(failure);
		process.exit(1);
	}
});

commander
.command('delete')
.description('Delete Stage from AWS.')
.action(async () => {
	if (!process.env.CI_COMMIT_REF_SLUG) {
		console.log('Deployment should not be done locally.');
		return;
	}

	packageMetadata.version = version;
	let awsArchitect = new AwsArchitect(packageMetadata, apiOptions);
	try {
		let result = await awsArchitect.removeStagePromise(process.env.CI_COMMIT_REF_SLUG);
		console.log(result);
	} catch (failure) {
		console.log(failure);
		process.exit(1);
	}
});

commander.on('*', () => {
	if (commander.args.join(' ') === 'tests/**/*.js') { return; }
	console.log(`Unknown Command: ${commander.args.join(' ')}`);
	commander.help();
	process.exit(0);
});
commander.parse(process.argv[2] ? process.argv : process.argv.concat(['build']));
