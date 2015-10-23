#!/usr/bin/env node
'use strict';

var https = require('https');
var request = require('request');

module.exports = Client;

function Client(accessKeyId, secretAccessKey, region) {
  this.Host = 'https://apigateway.us-east-1.amazonaws.com';

  request('http://www.google.com', function (error, response, body) {
    //if (!error && response.statusCode == 200) {
      console.log(body) // Show the HTML for the Google homepage.
    //}
  });

  /*
  this.CreateRequest = function(method, service, path, body){
    http_options = {
      service: service || 'apigateway',
      region: region,
      method: method.toUpperCase(),
      path: path
    }
    if(body) http_options.body = JSON.stringify(body);

    aws4.sign(http_options, {
      accessKeyId: accessKeyId,
      secretAccessKey: secretAccessKey
    });


    var request = https.request(opts, function(response) {
      var response_body = '';
      response.on('data', function(d) {
        response_body += d;
      });

      response.on('end', function() {
        if (~[200,201,203,205,206].indexOf(response.statusCode)) {
          // Successful w/ Body
          resolve(JSON.parse(response_body));
        }
        else if (~[202,204].indexOf(response.statusCode)) {
          //Successful w/o Body
          resolve({
            message:"Request is processing"
          });
        }
        else {
          response_body = JSON.parse(body);
          response_body.statusCode = response.statusCode;
          throw response_body;
        }
      });
    });

    request.on('error', function(e) {
      // General error, i.e.
      //  - ECONNRESET - server closed the socket unexpectedly
      //  - ECONNREFUSED - server did not listen
      //  - HPE_INVALID_VERSION
      //  - HPE_INVALID_STATUS
      throw e;
    });

    if (body) request.write(JSON.stringify(body));
    request.end();
  };

  */
}

var client = new Client();
/**
 * AWS RestApis


Client.prototype.listRestApis = function() {
  this.options.method = 'GET';
  this.options.path = '/restapis';
  this.options.body = null;
  return request(this.options);
};

Client.prototype.showRestApi = function(restApiId) {
  this.options.method = 'GET';
  this.options.path = '/restapis/' + restApiId;
  this.options.body = null;
  return request(this.options);
};

Client.prototype.createRestApi = function(body) {
  this.options.method = 'POST';
  this.options.path = '/restapis';
  this.options.body = body;
  return request(this.options);
};

Client.prototype.deleteRestApi = function(restApiId) {
  this.options.method = 'DELETE';
  this.options.path = '/restapis/' + restApiId;
  this.options.body = null;
  return request(this.options);
};

 * Resources


Client.prototype.listResources = function(restApiId) {
  this.options.method = 'GET';
  this.options.path = '/restapis/' + restApiId + '/resources';
  this.options.body = null;
  return request(this.options);
};

Client.prototype.createResource = function(restApiId, resourceParentId, pathPart) {
  this.options.method = 'POST';
  this.options.path = '/restapis/' + restApiId + '/resources/' + resourceParentId;
  this.options.body = { pathPart: pathPart };
  return request(this.options);
};

Client.prototype.showResource = function(restApiId, resourceId) {
  this.options.method = 'GET';
  this.options.path = '/restapis/' + restApiId + '/resources/' + resourceId;
  this.options.body = null;
  return request(this.options);
};

Client.prototype.deleteResource = function(restApiId, resourceId) {
  this.options.method = 'DELETE';
  this.options.path = '/restapis/' + restApiId + '/resources/' + resourceId;
  this.options.body = null;
  return request(this.options);
};

 * Methods
 

Client.prototype.putMethod = function(restApiId, resourceId, resourceMethod, body) {
  this.options.method = 'PUT';
  this.options.path = '/restapis/' + restApiId + '/resources/' + resourceId + '/methods/' + resourceMethod.toUpperCase();
  this.options.body = body;
  return request(this.options);
};

Client.prototype.showMethod = function(restApiId, resourceId, resourceMethod) {
  this.options.method = 'GET';
  this.options.path = '/restapis/' + restApiId + '/resources/' + resourceId + '/methods/' + resourceMethod.toUpperCase();
  this.options.body = null;
  return request(this.options);
};

Client.prototype.deleteMethod = function(restApiId, resourceId, resourceMethod) {
  this.options.method = 'DELETE';
  this.options.path = '/restapis/' + restApiId + '/resources/' + resourceId + '/methods/' + resourceMethod.toUpperCase();
  this.options.body = null;
  return request(this.options);
};

 * Integrations
 

Client.prototype.putIntegration = function(restApiId, resourceId, resourceMethod, body) {
  this.options.method = 'PUT';
  this.options.path = '/restapis/' + restApiId + '/resources/' + resourceId + '/methods/' + resourceMethod.toUpperCase() + '/integration';
  this.options.body = body;
  return request(this.options);
};

 * Method Response


Client.prototype.putMethodResponse = function(restApiId, resourceId, resourceMethod, statusCode, body) {
  this.options.method = 'PUT';
  this.options.path = '/restapis/' + restApiId + '/resources/' + resourceId + '/methods/' + resourceMethod.toUpperCase() + '/responses/' + statusCode;
  this.options.body = body;
  return request(this.options);
};


 * Integration Response
 

Client.prototype.putIntegrationResponse = function(restApiId, resourceId, resourceMethod, statusCode, body) {
  this.options.method = 'PUT';
  this.options.path = '/restapis/' + restApiId + '/resources/' + resourceId + '/methods/' + resourceMethod.toUpperCase() + '/integration/responses/' + statusCode;
  this.options.body = body;
  return request(this.options);
};


 * Stages
 

Client.prototype.listStages = function(restApiId) {
  this.options.method = 'GET';
  this.options.path = '/restapis/' + restApiId + '/stages';
  this.options.body = null;
  return request(this.options);
};

Client.prototype.putStage = function(restApiId, body) {
  this.options.method = 'POST';
  this.options.path = '/restapis/' + restApiId + '/stages';
  this.options.body = body;
  return request(this.options);
};

Client.prototype.showStage = function(restApiId, stageName) {
  this.options.method = 'GET';
  this.options.path = '/restapis/' + restApiId + '/stages/' + stageName.toLowerCase();
  this.options.body = null;
  return request(this.options);
};

Client.prototype.deleteStage = function(restApiId, stageName) {
  this.options.method = 'DELETE';
  this.options.path = '/restapis/' + restApiId + '/stages/' + stageName.toLowerCase();
  this.options.body = null;
  return request(this.options);
};

*
 * Deployments

Client.prototype.createDeployment = function(restApiId, body) {
  this.options.method = 'POST';
  this.options.path = '/restapis/' + restApiId + '/deployments';
  this.options.body = body;
  return request(this.options);
};

Client.prototype.listDeployments = function(restApiId) {
  this.options.method = 'GET';
  this.options.path = '/restapis/' + restApiId + '/deployments';
  this.options.body = null;
  return request(this.options);
};

*/