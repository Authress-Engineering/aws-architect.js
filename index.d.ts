interface PackageMetadata {
  name: string;
  version: string;
}

interface ApiOptions {
  regions: string[];
  deploymentBucket: string,
  sourceDirectory: string,
  description: string,
}

interface ContentOptions {
  bucket: string;
  contentDirectory: string;
}

interface PublishLambdaOptions {
  zipFileName: string;
  bucket: string;
  autoHandleCompileOfSourceDirectory: boolean;
}

interface PublishZipOptions {
  zipFileName: string;
  sourceDirectory: string;
}

interface StackConfiguration {
  changeSetName: string;
  stackName: string;
  automaticallyProtectStack: boolean;
}

interface StackSetConfiguration {
  changeSetName: string;
  stackSetName: string;
  regions: string[];
}


interface StageDeploymentOptions {
  stage: string;
  functionName: string;
  deploymentBucketName: string;
  deploymentKeyName: string;
}

interface RegexOption {
  explicit?: string,
  regex?: RegExp,
  value: string | number
}

interface WebsiteDeploymentOptions {
  cacheControlRegexMap: RegexOption[];
  contentTypeMappingOverride: object;
}

declare class AwsArchitect {
	constructor(packageMetadata: PackageMetadata, apiOptions: ApiOptions, contentOptions: ContentOptions);
	publishZipArchive(options: PublishZipOptions): Promise<object>;
	publishLambdaArtifactPromise(options: PublishLambdaOptions): Promise<object>;
	validateTemplate(stackTemplate: object): Promise<object>;
  deployTemplate(stackTemplate: object, stackConfiguration: StackConfiguration, parameters: object): Promise<object>;
  deployStackSetTemplate(stackTemplate: object, stackSetConfiguration: StackSetConfiguration, parameters: object): Promise<object>;
	deployStagePromise(stage: string, lambdaVersion: string): Promise<object>;
	removeStagePromise(stage: string, functionName: string): Promise<object>;
	cleanupPreviousFunctionVersions(functionName: string, forceRemovalOfAliases: string): Promise<object>;
	publishAndDeployStagePromise(options: StageDeploymentOptions): Promise<object>;
	publishWebsite(version: string, options: WebsiteDeploymentOptions): Promise<object>;
	run(port: number, logger: Function): Promise<object>;
}

export = AwsArchitect;
