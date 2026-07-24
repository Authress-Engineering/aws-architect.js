const { APIGatewayClient, GetRestApisCommand, DeleteStageCommand, CreateDeploymentCommand } = require('@aws-sdk/client-api-gateway');
const {
  ApiGatewayV2Client, GetApisCommand, DeleteStageCommand: DeleteStageV2Command,
  GetStageCommand, CreateStageCommand, CreateDeploymentCommand: CreateDeploymentV2Command
} = require('@aws-sdk/client-apigatewayv2');

class ApiGatewayManager {
  constructor(serviceName, version, region) {
    this.ServiceName = serviceName;
    this.Version = version;
    this.apiGatewayFactory = new APIGatewayClient({ region });
    this.apiGatewayFactoryV2 = new ApiGatewayV2Client({ region });
  }

  async GetApiGatewayPromise() {
    const apisV2 = await this.apiGatewayFactoryV2.send(new GetApisCommand({ MaxResults: '500' }));
    const serviceApiV2 = apisV2.Items.find(api => api.Name === this.ServiceName);
    if (serviceApiV2) {
      return { Id: serviceApiV2.ApiId, id: serviceApiV2.ApiId, Name: serviceApiV2.Name, serviceName: serviceApiV2.Name };
    }

    const apis = await this.apiGatewayFactory.send(new GetRestApisCommand({ limit: 500 }));
    let serviceApi = apis.items.find(api => api.name === this.ServiceName);
    if (serviceApi) {
      return { Id: serviceApi.id, id: serviceApi.id, Name: serviceApi.name, serviceName: serviceApi.name, legacy: true };
    }

    const error = new Error(`API Gateway REST API does not yet exist. ${this.ServiceName}`);
    error.code = 'ApiGatewayServiceNotFound';
    throw error;
  }

  async RemoveStagePromise(apiGateway, stageName) {
    try {
      if (apiGateway.legacy) {
        const params = { restApiId: apiGateway.id, stageName: stageName };
        await this.apiGatewayFactory.send(new DeleteStageCommand(params));
      } else {
        const params = { ApiId: apiGateway.id, StageName: stageName };
        await this.apiGatewayFactoryV2.send(new DeleteStageV2Command(params));
      }
    } catch (error) {
      if (error.name !== 'NotFoundException') {
        throw error;
      }
    }
  }

  async DeployStagePromise(apiGateway, stageName, stage, lambdaVersion) {
    try {
      if (apiGateway.legacy) {
        const success = await this.apiGatewayFactory.send(new CreateDeploymentCommand({
          restApiId: apiGateway.id,
          stageName: stageName,
          description: `${stage} (lambdaVersion: ${lambdaVersion})`,
          variables: {
            lambdaVersion: stageName
          }
        }));
        return {
          Title: `Created Deployment stage: ${stageName}@${lambdaVersion}`,
          Stage: stageName,
          LambdaVersion: lambdaVersion,
          DeploymentId: success.id
        };
      }

      try {
        const stageData = await this.apiGatewayFactoryV2.send(new GetStageCommand({ ApiId: apiGateway.id, StageName: stageName }));
        if (stageData.AutoDeploy) {
          return {
            Title: `Skipping. Deployment fully handled by API Gateway. ${stageName}@${lambdaVersion}`,
            Stage: stageName,
            LambdaVersion: lambdaVersion,
            DeploymentId: stageData.DeploymentId
          };
        }
      } catch (error) {
        if (error.name !== 'NotFoundException') {
          throw error;
        }

        await this.apiGatewayFactoryV2.send(new CreateStageCommand({
          ApiId: apiGateway.id,
          StageName: stageName,
          AutoDeploy: true,
          StageVariables: {
            lambdaVersion: stageName
          }
        }));
      }

      const success = await this.apiGatewayFactoryV2.send(new CreateDeploymentV2Command({
        ApiId: apiGateway.id,
        StageName: stageName,
        Description: `${stage} (lambdaVersion: ${lambdaVersion})`
      }));
      return {
        Title: `Created Deployment stage: ${stageName}@${lambdaVersion}`,
        Stage: stageName,
        LambdaVersion: lambdaVersion,
        DeploymentId: success.DeploymentId
      };
    } catch (failure) {
      throw {
        Title: `Failed creating Deployment stage: ${stageName}@${lambdaVersion}`,
        Details: failure
      };
    }
  }
}

module.exports = ApiGatewayManager;
