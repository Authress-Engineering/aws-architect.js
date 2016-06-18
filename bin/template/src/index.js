var aws = require('aws-sdk');
var util = require('util');

exports.handler = (event, context, callback) => {
    try {
        console.log(`event: ${event}`);
        console.log(`context: ${JSON.stringify(context, null, 2)}`);
        if(!context.identity || !context.identity.cognitoIdentityId) {
             return callback(JSON.stringify({statusCode: 400, title: 'User Identity must be defined "context.identity.cognitoIdentityId"'}));
        }
        var user = context.identity.cognitoIdentityId;
        var params = {
          Key: { userId: user },
          TableName: context.local ? 'counter.example-microservice.test' : 'counter.example-microservice.production',
          ConsistentRead: true
        };

        var docClient = new aws.DynamoDB.DocumentClient();
        docClient.get(params, (err, data) => {
          if (err) { callback(JSON.stringify({statusCode: 500, error: err})); }
          else { callback(JSON.stringify({statusCode: 200, data: data})); }
        });
    }
    catch (exception) {
        console.error(exception.stack || exception);
        callback(JSON.stringify({statusCode: 500, event: event, contexet: context}));
    }
};