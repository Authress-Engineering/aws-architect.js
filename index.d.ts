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
	zipFileName: String;
  bucket: String;
  autoHandleCompileOfSourceDirectory: Boolean;
}

interface PublishZipOptions {
	zipFileName: String;
	sourceDirectory: String;
}

interface StackConfiguration {
	changeSetName: String;
	stackName: String;
	automaticallyProtectStack: Boolean;
}


interface StageDeploymentOptions {
	stage: String;
	functionName: String;
	deploymentBucketName: String;
	deploymentKeyName: String;
}

interface RegexOption {
	explicit?: String,
	regex?: RegExp,
	value: String | Number
}

interface WebsiteDeploymentOptions {
	cacheControlRegexMap: RegexOption[];
	contentTypeMappingOverride: Object;
}

declare class AwsArchitect {
	constructor(packageMetadata: PackageMetadata, apiOptions: ApiOptions, contentOptions: ContentOptions);
	publishZipArchive(options: PublishZipOptions): Promise<Object>;
	publishLambdaArtifactPromise(options: PublishLambdaOptions): Promise<Object>;
	validateTemplate(stackTemplate: Object): Promise<Object>;
	deployTemplate(stackTemplate: Object, stackConfiguration: StackConfiguration, parameters: Object): Promise<Object>;
	deployStagePromise(stage: String, lambdaVersion: String): Promise<Object>;
	removeStagePromise(stage: String): Promise<Object>;
	publishAndDeployStagePromise(options: StageDeploymentOptions): Promise<Object>;
	publishWebsite(version: String, options: WebsiteDeploymentOptions): Promise<Object>;
	run(port: Number, logger: Function): Promise<Object>;
}
