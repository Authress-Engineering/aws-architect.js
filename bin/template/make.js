require('error-object-polyfill');
const path = require('path');
const commander = require('commander');
const AwsArchitect = require('aws-architect');

// aws.config.credentials = new aws.SharedIniFileCredentials({profile: 'default'});

let ci = require('ci-build-tools')(process.env.GIT_TAG_PUSHER);
let version = ci.GetVersion();
commander.version(version);

let packageMetadataFile = path.join(__dirname, 'package.json');
let packageMetadata = require(packageMetadataFile);

const deploymentBucket = 'master-deployment-artifacts-s3-bucket';
let apiOptions = {
	sourceDirectory: path.join(__dirname, 'src'),
	description: 'This is the description of the lambda function',
	regions: ['eu-west-1']
};
let contentOptions = {
	bucket: 'WEBSITE_BUCKET_NAME',
	contentDirectory: path.join(__dirname, 'content')
};

commander
.command('run')
.description('Run lambda web service locally.')
.action(() => {
	// default logger is console.log, if you want to override it, can be done here.
	let logger = logMessage => console.log(logMessage);
	let awsArchitect = new AwsArchitect(packageMetadata, apiOptions, contentOptions);
	awsArchitect.run(8080, logger)
	.then(result => console.log(JSON.stringify(result, null, 2)))
	.catch(failure => console.log(JSON.stringify(failure, null, 2)));
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
		await awsArchitect.ValidateTemplate(stackTemplate);
		await awsArchitect.PublishLambdaArtifactPromise({ bucket: deploymentBucket });
		if (isMasterBranch) {
			let stackConfiguration = {
				changeSetName: `${process.env.CI_COMMIT_REF_SLUG}-${process.env.CI_PIPELINE_ID || '1'}`,
				stackName: packageMetadata.name
			};
			let parameters = {
				serviceName: packageMetadata.name,
				serviceDescription: packageMetadata.description,
				deploymentBucketName: deploymentBucket,
				deploymentKeyName: `${packageMetadata.name}/${version}/lambda.zip`,
				dnsName: packageMetadata.name.toLowerCase(),
				hostedName: 'toplevel.domain.io',
				useRoot: 'false'
			};
			await awsArchitect.DeployTemplate(stackTemplate, stackConfiguration, parameters);
		}

		let publicResult = await awsArchitect.PublishAndDeployStagePromise({
			stage: isMasterBranch ? 'production' : process.env.CI_COMMIT_REF_SLUG,
			functionName: packageMetadata.name,
			deploymentBucketName: deploymentBucket,
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
	
	let awsArchitect = new AwsArchitect(packageMetadata, null, contentOptions);
	let stackTemplate = require('./cloudFormationWebsiteTemplate.json');
	let isMasterBranch = process.env.CI_COMMIT_REF_SLUG === 'master';

	try {
		await awsArchitect.validateTemplate(stackTemplate);
		if (isMasterBranch) {
			let stackConfiguration = {
				changeSetName: `${process.env.CI_COMMIT_REF_SLUG}-${process.env.CI_PIPELINE_ID || '1'}`,
				stackName: packageMetadata.name
			};
			let parameters = {
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
			cacheControlRegexMap: {
				'index.html': 600,
				'default': 24 * 60 * 60
			},
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
.command('delete')
.description('Delete Stage from AWS.')
.action(() => {
	if (!process.env.CI_COMMIT_REF_SLUG) {
		console.log('Deployment should not be done locally.');
		return;
	}

	packageMetadata.version = version;
	let awsArchitect = new AwsArchitect(packageMetadata, apiOptions);
	return awsArchitect.removeStagePromise(process.env.CI_COMMIT_REF_SLUG)
	.then(result => {
		console.log(result);
	}, failure => {
		console.log(failure);
		process.exit(1);
	});
});

commander.on('*', () => {
	if (commander.args.join(' ') === 'tests/**/*.js') { return; }
	console.log(`Unknown Command: ${commander.args.join(' ')}`);
	commander.help();
	process.exit(0);
});
commander.parse(process.argv[2] ? process.argv : process.argv.concat(['build']));
