const { APIGateway, ApiGatewayV2 } = require('aws-sdk');

class ApiGatewayManager {
  constructor(serviceName, version, region) {
    this.ServiceName = serviceName;
    this.Version = version;
    this.apiGatewayFactory = new APIGateway({ region });
    this.apiGatewayFactoryV2 = new ApiGatewayV2({ region });
  }

  async GetApiGatewayPromise() {
    const apisV2 = await this.apiGatewayFactoryV2.getApis({ MaxResults: '500' }).promise();
    const serviceApiV2 = apisV2.Items.find(api => api.Name === this.ServiceName);
    if (serviceApiV2) {
      return { Id: serviceApiV2.ApiId, id: serviceApiV2.ApiId, Name: serviceApiV2.Name, serviceName: serviceApiV2.Name };
    }

    const apis = await this.apiGatewayFactory.getRestApis({ limit: 500 }).promise();
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
        await this.apiGatewayFactory.deleteStage(params).promise();
      } else {
        const params = { ApiId: apiGateway.id, StageName: stageName };
        await this.apiGatewayFactoryV2.deleteStage(params).promise();
      }
    } catch (error) {
      if (error.code !== 'NotFoundException') {
        throw error;
      }
    }
  }

  async DeployStagePromise(apiGateway, stageName, stage, lambdaVersion) {
    try {
      if (apiGateway.legacy) {
        const success = this.apiGatewayFactory.createDeployment({
          restApiId: apiGateway.id,
          stageName: stageName,
          description: `${stage} (lambdaVersion: ${lambdaVersion})`,
          variables: {
            lambdaVersion: stageName
          }
        }).promise();
        return {
          Title: `Created Deployment stage: ${stageName}@${lambdaVersion}`,
          Stage: stageName,
          LambdaVersion: lambdaVersion,
          DeploymentId: success.id
        };
      }

      try {
        const stageData = await this.apiGatewayFactoryV2.getStage({ ApiId: apiGateway.id, StageName: stageName }).promise();
        if (stageData.AutoDeploy) {
          return {
            Title: `Skipping. Deployment fully handled by API Gateway. ${stageName}@${lambdaVersion}`,
            Stage: stageName,
            LambdaVersion: lambdaVersion,
            DeploymentId: stageData.DeploymentId
          };
        }
      } catch (error) {
        if (error.code !== 'NotFoundException') {
          throw error;
        }
      }

      const success = this.apiGatewayFactoryV2.createDeployment({
        ApiId: apiGateway.id,
        StageName: stageName,
        Description: `${stage} (lambdaVersion: ${lambdaVersion})`
      }).promise();
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
