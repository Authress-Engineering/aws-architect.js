const stringify = require('json-stringify-safe');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const express = require('express');
const http = require('http');
const morgan = require('morgan');
const normalizeHeaderCase = require('header-case-normalizer');
const cloneDeep = require('lodash.clonedeep');

function replaceErrors(_, value) {
  if (value instanceof Error) {
    let error = {};
    Object.getOwnPropertyNames(value).forEach(key => {
      error[key] = value[key];
    });
    return error;
  }
  return value;
}

function fixHeaders(headers) {
  Object.keys(headers).map(key => {
    headers[normalizeHeaderCase(key)] = headers[key];
  });
}

function Server(contentDirectory, lambdaApi, logger) {
  this.logger = logger || console.log;
  this.internalServer = null;
  this.App = express();
  //Logger
  this.App.use(morgan('dev'));
  this.App.use(cookieParser());

  // Log every request to the console.
  this.App.use((req, res, next) => {
    this.logger('********************************************************************************');
    fixHeaders(req.headers);
    this.logger(`Request Headers: ${stringify(req.headers, null, 2)}`);
    this.logger('----------------------------------');
    next();
  });

  /**********************/
  /*		 API		*/

  let events = express.Router();
  events.use(bodyParser.json({ type: '*/*' }));
  this.App.use('/triggers/', events);
  events.post('/event', async (req, res) => {
    this.logger(`New Event: ${stringify(req.body, null, 2)}`);
    try {
      let context = {
        functionName: 'lambdaApi',
        invokedFunctionArn: 'arn::::::self',
        stage: 'local',
        local: true,
        identity: {
          cognitoIdentityId: 'local',
          cognitoIdentityPoolId: null
        }
      };
      let eventHandler = lambdaApi.handlers && lambdaApi.handlers.onEvent || lambdaApi.onEvent;
      let result = await eventHandler(req.body, context);
      return res.status(200).json(result || {});
    } catch (exception) {
      this.logger(stringify({ title: 'Exception thrown by invocation of the runtime event function, check the implementation.', error: exception }, replaceErrors, 2));
      let body = exception instanceof Error ? exception.toString() : exception;
      return res.status(500).json({ title: 'Internal Error, check logs', error: body });
    }
  });
  events.post('/schedule', async (req, res) => {
    this.logger(`New Schedule: ${stringify(req.body)}`);
    try {
      let context = {
        functionName: 'lambdaApi',
        invokedFunctionArn: 'arn::::::self',
        stage: 'local',
        local: true,
        identity: {
          cognitoIdentityId: 'local',
          cognitoIdentityPoolId: null
        }
      };
      let scheduleHandler = lambdaApi.handlers && lambdaApi.handlers.onSchedule || lambdaApi.onSchedule;
      let result = await scheduleHandler(req.body, context);
      return res.status(200).json(result || {});
    } catch (exception) {
      this.logger(stringify({ title: 'Exception thrown by invocation of the runtime event function, check the implementation.', error: exception }, replaceErrors, 2));
      let body = exception instanceof Error ? exception.toString() : exception;
      return res.status(500).json({ title: 'Internal Error, check logs', error: body });
    }
  });

  let api = express.Router();
  this.App.use('/api/', api);

  api.use(bodyParser.text({ type: ['application/x-www-form-urlencoded', 'text/css', 'text/csv', 'text/html', 'text/plain', 'text/html'] }));
  api.use(bodyParser.raw({ type: ['application/octet-stream', 'application/binary', 'image/*', 'audio/*', 'video/*', 'application/pdf', 'application/x-tar', 'application/zip'], limit: '6mb' }));
  api.use(bodyParser.json({ type: '*/*', limit: '6mb' }));
  /* eslint-disable-next-line no-unused-vars */
  api.use((error, req, res, next) => {
    this.logger(stringify({ title: 'Failed to parse the body', error }));
    res.status(400).send({ title: 'Invalid body parsing, it can be due to the default parsing types that are set up in AWS Architect Server configuration' });
  });

  Object.keys(lambdaApi.Routes || []).map(method => {
    const sortedPathKeys = Object.keys(lambdaApi.Routes[method]).sort((a, b) => a.split('/').length - b.split('/').length || a.split('{').length - b.split('{').length);
    sortedPathKeys.map(resource => {
      let isProxy = resource.match(/{proxy\+}/);
      let expressResource = resource.replace(/{proxy\+}/, '*').replace(/{([^{}]+)}/g, ':$1');
      api.all(expressResource, async (req, res) => {
        let event = {
          resource: resource,
          path: req.path,
          httpMethod: req.method,
          headers: req.headers || {},
          queryStringParameters: req.query,
          pathParameters: isProxy ? { proxy: req.params[0] } : req.params || {},
          body: req.body,
          stageVariables: { lambdaVersion: 'local' },
          requestContext: {
            requestId: 'Invoked-from-AwsArchitect',
            resourceId: 'local',
            stage: 'local',
            identity: {
              cognitoIdentityId: 'local',
              cognitoIdentityPoolId: null,
              apiKey: null,
              sourceIp: req.headers['x-forwarded-for'] || req.connection.remoteAddress,
              userAgent: req.get('User-Agent')
            }
          }
        };
        let context = {
          functionName: 'lambdaApi',
          stage: 'local',
          local: true,
          identity: {
            cognitoIdentityId: 'local',
            cognitoIdentityPoolId: null
          }
        };

        if (req.method !== 'OPTIONS') {
          try {
            const authorizationEvent = cloneDeep(event);
            authorizationEvent.type = 'REQUEST';
            authorizationEvent.methodArn = req.method;
            let result = { principalId: '<no-authorizer-func-specified>' };
            if (lambdaApi.Authorizer.AuthorizerFunc || lambdaApi.authorizer || lambdaApi.Authorizer) {
              result = await lambdaApi.handler(authorizationEvent, context);
            }
            // AWS authorizers do not accept objects
            if (Object.values(result.context || {}).some(c => typeof c === 'object')) {
              throw Error('AuthorizerContextPropertieValuesMustBeConvertableToString');
            }

            if (result.isAuthorized === false) {
              return res.status(401).json({ code: 'Unauthorized', title: 'Authorizer returned rejection' });
            }

            // AWS Authorizers convert all properties to strings
            const contextClone = cloneDeep(result.context || {});
            Object.keys(contextClone).filter(p => contextClone[p] !== undefined).forEach(p => {
              contextClone[p] = `${contextClone[p]}`;
            });
            event.requestContext.authorizer = contextClone || {};
            event.requestContext.authorizer.principalId = result.principalId;
          } catch (authorizerError) {
            console.error(authorizerError.stack || authorizerError);
            res.set({
              'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key',
              'Access-Control-Allow-Methods': 'DELETE,GET,HEAD,OPTIONS,PATCH,POST,PUT',
              'Access-Control-Allow-Origin': '*'
            });
            return res.status(authorizerError === 'Unauthorized' || authorizerError.message === 'Unauthorized' ? 401 : 403).json({
              code: 'Unauthorized',
              title: 'Authorizer returned rejection',
              response: authorizerError.toString()
            });
          }
        }

        let response = null;
        try {
          response = await lambdaApi.handler(event, context);
          if (!response.statusCode) { response.statusCode = 200; }
        } catch (exception) {
          this.logger('Failure in resource path execution', exception);
          return res.status(500).json({
            code: 'AuthorizationRuntimeFailure',
            title: 'Failure in resource path execution',
            error: exception.stack || exception.toString()
          });
        }

        const responseHeaders = cloneDeep(response.headers || {});
        Object.keys(responseHeaders).filter(h => h.match(/location/i)).forEach(header => {
          responseHeaders[header] = responseHeaders[header].replace(/^https?:\/\/(localhost:\d{2,5})\/(.*)$/g, 'http://$1/api/$2');
        });
        const multiValueHeaders = cloneDeep(response.multiValueHeaders || {});
        Object.keys(multiValueHeaders).filter(h => multiValueHeaders[h]).forEach(h => {
          responseHeaders[h] = multiValueHeaders[h].filter(v => v).map(v => v.replace(/^https?:\/\/(localhost:\d{2,5})\/(.*)$/g, 'http://$1/api/$2'));
        });

        if (Array.isArray(responseHeaders['Content-Type'])) {
          responseHeaders['Content-Type'] = responseHeaders['Content-Type'][0];
        }

        res.set(responseHeaders);

        this.logger(`StatusCode: ${response.statusCode}`);
        this.logger(`Headers: ${stringify(responseHeaders, null, 2)}`);

        if (response.isBase64Encoded) {
          this.logger('Body: <Binary>');
          return res.status(response.statusCode).send(Buffer.from(response.body, 'base64'));
        }

        try {
          response.body = response.body && response.body.replace(/"https?:\/\/(localhost:\d{2,5})\/([^"]*)"/g, '"http://$1/api/$2"');
          let json = JSON.parse(response.body);
          this.logger(`Body: ${stringify(json, null, 2)}`);
          return res.status(response.statusCode).json(json);
        } catch (exception) {
          this.logger('Body: Not-JSON');
          return res.status(response.statusCode).send(response.body);
        }
      });
    });
  });

  /* eslint-disable-next-line no-unused-vars */
  api.all(/.*/, (req, res, next) => {
    res.status(404).json({
      statusCode: 404,
      title: `Resource not found at ${req.originalUrl}`
    });
  });

  /* eslint-disable-next-line no-unused-vars */
  api.use((error, req, res, next) => {
    console.error(`Catch-all Error: ${error.stack || error} - ${stringify(error, null, 2)}`);
    res.status(500).json({
      statusCode: 500,
      title: 'Catch-all Error',
      detail: error.stack || error.toString()
    });
  });

  /**********************/

  let web = express.Router();
  this.App.use('/', web);
  web.get(/^(.*)$/, (req, res) => {
    res.status(200).send({
      routes: [
        '/api/',
        '/triggers/event',
        '/triggers/schedule'
      ]
    });
    return res.end();
  });
}

function checkPort(port) {
  return new Promise((resolve, reject) => {
    let server = http.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(port, () => {
      server.close(() => {
        resolve(port);
      });
    });
  });
}

async function getNextPort(initialPort) {
  for (let attemptedPort = initialPort; attemptedPort < initialPort + 10 && attemptedPort <= 65535; attemptedPort++) {
    try {
      return await checkPort(attemptedPort);
    } catch (error) { /**/ }
  }
  return 0;
}

Server.prototype.Run = async function(port) {
  let httpServer = http.createServer(this.App);
  // set local HTTP server timeout to max Lambda timeout of 15 minutes; default is 2 minutes
  // see https://nodejs.org/dist/latest-v6.x/docs/api/http.html#http_server_settimeout_msecs_callback
  httpServer.setTimeout(15 * 60 * 1000);
  http.createServer(this.App);

  let availablePort = await getNextPort(port);
  this.internalServer = httpServer.listen(availablePort);
  return this.internalServer.address().port;
};

Server.prototype.stop = function() {
  return new Promise((resolve, reject) => {
    this.internalServer.close(error => error ? reject(error) : resolve());
  });
};

module.exports = Server;
