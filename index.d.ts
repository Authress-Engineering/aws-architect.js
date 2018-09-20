interface PackageMetadata {
	name: String;
	version: String;
}

interface ApiOptions {
	regions: String[];
}

interface ContentOptions {
	bucket: String;
	contentDirectory: String;
}

interface PublishLambdaOptions {
	bucket: String;
}

interface StackConfiguration {

}

interface StackParameters {

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
	publishLambdaArtifactPromise(options: PublishLambdaOptions): Promise<Boolean>;
	validateTemplate(stackTemplate: Object): Promise<Boolean>;
	deployTemplate(stackTemplate: Object, stackConfiguration: StackConfiguration, parameters: StackParameters): Promise<Boolean>;
	deployStagePromise(stage: String, lambdaVersion: String): Promise<Boolean>;
	removeStagePromise(stage: String): Promise<Boolean>;
	publishAndDeployStagePromise(options: StageDeploymentOptions): Promise<Boolean>;
	publishWebsite(version: String, options: WebsiteDeploymentOptions): Promise<Boolean>;
	run(port: Short; logger: Function): Promise<Boolean>;
}
