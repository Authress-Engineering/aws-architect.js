'use strict';

/**
 * Module dependencies
 */
var fs = require('fs');
var path = require('path');

// const aws = require('aws-sdk');
// aws.config.credentials = new aws.SharedIniFileCredentials({profile: 'default'});

var AwsArchitect = require('aws-architect');
var ci = require('ci-build-tools')(process.env.GIT_TAG_PUSHER);
var version = ci.GetVersion();
var commander = require('commander');
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
		packageMetadata.version = version;
		fs.writeFileSync(packageMetadataFile, JSON.stringify(packageMetadata, null, 2));
	
		let awsArchitect = new AwsArchitect(packageMetadata, apiOptions);
		let stackTemplate = require('./cloudFormationServerlessTemplate.json');
		let cloudFormationPromise = awsArchitect.ValidateTemplate(stackTemplate);
		let stageName = 'local';

		return cloudFormationPromise
		.then(() => {
		  if (isMasterBranch === 'master') {
			return awsArchitect.PublishLambdaArtifactPromise({ bucket: deploymentBucket })
			.then(() => {
			  let stackConfiguration = {
				changeSetName: `${stageName}-${version || '1' }`,
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
		  else {
			return awsArchitect.PublishAndDeployPromise(stageName, []);
		  }
		})
		.then((result) => console.log(`${JSON.stringify(result, null, 2)}`));

		var websitePromise = awsArchitect.PublishWebsite(version, { configureBucket: true })
		.then((result) => console.log(`${JSON.stringify(result, null, 2)}`))

		Promise.all([cloudFormationPromise, websitePromise])
		.catch((failure) => {
			console.log(`${failure.Details} - ${JSON.stringify(failure, null, 2)}`)
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