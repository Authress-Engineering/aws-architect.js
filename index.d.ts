interface PackageMetadata {
	name: String;
	version: String;
}

interface ApiOptions {
	regions: String[];
	deploymentBucket: String,
	sourceDirectory: String,
	description: String,
}

interface ContentOptions {
	bucket: String;
	contentDirectory: String;
}

interface PublishLambdaOptions {
	bucket: String;
}

interface StackConfiguration {
	changeSetName: String;
	stackName: String;
}

interface StageDeploymentOptions {
	stage: String;
	functionName: String;
	deploymentBucketName: String;
	deploymentKeyName: String;
}

interface WebsiteDeploymentOptions {
	cacheControlRegexMap: Object;
	contentTypeMappingOverride: Object;
}

declare class AwsArchitect {
	constructor(packageMetadata: PackageMetadata, apiOptions: ApiOptions, contentOptions: ContentOptions);
	publishLambdaArtifactPromise(options: PublishLambdaOptions): Promise<Object>;
	validateTemplate(stackTemplate: Object): Promise<Object>;
	deployTemplate(stackTemplate: Object, stackConfiguration: StackConfiguration, parameters: Object): Promise<Object>;
	deployStagePromise(stage: String, lambdaVersion: String): Promise<Object>;
	removeStagePromise(stage: String): Promise<Object>;
	publishAndDeployStagePromise(options: StageDeploymentOptions): Promise<Object>;
	publishWebsite(version: String, options: WebsiteDeploymentOptions): Promise<Object>;
	run(port: Number, logger: Function): Promise<Object>;
}
