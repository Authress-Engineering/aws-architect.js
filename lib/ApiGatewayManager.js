class ApiGatewayManager {
  constructor(serviceName, version, apiGatewayFactory) {
    this.ServiceName = serviceName;
    this.Version = version;
    this.ApiGatewayFactory = apiGatewayFactory;
  }

  GetApiGatewayPromise() {
    let apiGatewayFactory = this.ApiGatewayFactory;
    return apiGatewayFactory.getRestApis({ limit: 500 }).promise()
    .then(apis => {
      let serviceApi = apis.items.find(api => api.name === this.ServiceName);
      if (!serviceApi) {
        const error = new Error(`API Gateway REST API does not yet exist. ${this.ServiceName}`);
        error.code = 'ApiGatewayServiceNotFound';
        throw error;
      }
      return { Id: serviceApi.id, id: serviceApi.id, Name: serviceApi.name, serviceName: serviceApi.name };
    });
  }

  async RemoveStagePromise(restApiId, stageName) {
    let params = {
      restApiId: restApiId,
      stageName: stageName
    };

    try {
      await this.ApiGatewayFactory.deleteStage(params).promise();
    } catch (error) {
      if (error.code !== 'NotFoundException') {
        throw error;
      }
    }
  }

  DeployStagePromise(restApiId, stageName, stage, lambdaVersion) {
    return this.ApiGatewayFactory.createDeployment({
      restApiId: restApiId,
      stageName: stageName,
      description: `${stage} (lambdaVersion: ${lambdaVersion})`,
      variables: {
        lambdaVersion: stageName
      }
    }).promise()
    .then(success => {
      return {
        Title: `Created Deployment stage: ${stageName}@${lambdaVersion}`,
        Stage: stageName,
        LambdaVersion: lambdaVersion,
        DeploymentId: success.id
      };
    })
    .catch(failure => {
      throw {
        Title: `Failed creating Deployment stage: ${stageName}@${lambdaVersion}`,
        Details: failure
      };
    });
  }
}

module.exports = ApiGatewayManager;
