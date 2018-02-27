'use strict';

var bodyParser = require('body-parser');
var cookieParser = require('cookie-parser');
var express = require('express');
var morgan = require('morgan');
var path = require('path');
var normalizeHeaderCase = require("header-case-normalizer");

function fixHeaders(headers) {
	Object.keys(headers).map(key => {
		headers[normalizeHeaderCase(key)] = headers[key];
	});
}

function Server(contentDirectory, lambdaApi, logger) {
	this.logger = logger || console.log;
	this.App = express();
	//Logger
	this.App.use(morgan('dev'));
	this.App.use(cookieParser());

	// Log every request to the console.
	this.App.use((req, res, next) => {
		this.logger("********************************************************************************");
		fixHeaders(req.headers);
		this.logger("Request Headers: " + JSON.stringify(req.headers, null, 2));
		this.logger("----------------------------------");
		next();
	});

	/**********************/
	/*		 API		*/

	var api = express.Router();
	this.App.use('/api/', api);

	api.use(bodyParser.json({ type: '*/*' }));
	api.use((error, req, res, next) => {
		res.status(400).send({error: 'Invalid JSON'});
	});

	api.get('/', (req, res, next) => {
		try {
			Promise.resolve(null)
			.then((data) => {
				res.send({});
				res.end();
			})
			.catch((error) => {
				var message = `Error: ${error}`;
				console.error(message);
				res.status(400).send(message);
			});
		}
		catch (exception) {
			var message = `Error: ${exception}`;
			console.error(message);
			res.status(500).send(message);
		}
	});

	Object.keys(lambdaApi.Routes || []).map(method => {
		Object.keys(lambdaApi.Routes[method]).map(resource => {
			var expressResource = resource.replace(/{proxy\+}/, '*').replace(/{([^\{\}]+)}/g, ':$1');
			api.all(expressResource, (req, res) => {
				var event = {
					resource: resource,
					path: req.path,
					httpMethod: req.method,
					headers: req.headers || {},
					queryStringParameters: req.query,
					pathParameters: req.params || {},
					body: req.body,
					stageVariables: { lambdaVersion : 'local' }
				};
				var context = {
					functionName: 'lambdaApi',
					stage: 'local',
					local: true,
					identity: {
						cognitoIdentityId: 'local',
						cognitoIdentityPoolId: null
					}
				};

				var callback = (_, response) => {
					this.logger(`StatusCode: ${response.statusCode}`);
					this.logger(`Headers: ${JSON.stringify(response.headers, null, 2)}`);
					if (response.headers) { res.set(response.headers); }
					if (!response.statusCode) { response.statusCode = 200; }
					try {
						var json = JSON.parse(response.body);
						this.logger(`Body: ${JSON.stringify(json, null, 2)}`);
						return res.status(response.statusCode).json(json);
					}
					catch (exception) {
						this.logger(`Body: Binary}`);
						return res.status(response.statusCode).send(response.body);
					}
				};

				if (!lambdaApi.Authorizer || !lambdaApi.Authorizer.AuthorizerFunc) {
					lambdaApi.Authorizer.AuthorizerFunc = () => ({ principalId: '<no-authorizer-func-specified>' });
				}

				try {
					return Promise.resolve(lambdaApi.Authorizer.AuthorizerFunc(event))
					.then(promiseResult => {
						event.requestContext = {
							authorizer: {
								principalId: promiseResult.principalId
							}
						};
						lambdaApi.handler(event, context, callback);
					}, authorizerError => {
						console.error(authorizerError.stack || authorizerError);
						res.status(authorizerError === 'Unauthorized' ? 401 : 403).json({
							code: 'Unauthorized',
							title: 'Authorizer returned rejection',
							response: authorizerError.toString()
						});
					});
				} catch (exception) {
					res.status(500).json({
						code: 'AuthorizationRuntimeFailure',
						title: 'Synchronous failure in authorizer',
						error: exception.stack || exception.toString()
					});
				}
			});
		});
	});

	api.all(/.*/, (req, res, next) => {
		res.status(404).json({
			statusCode: 404,
			title: `Resource not found at ${req.originalUrl}`
		});
	});

	api.use((error, req, res, next) => {
		console.error(`Catch-all Error: ${error.stack || error} - ${JSON.stringify(error, null, 2)}`);
		res.status(500).json({
			statusCode: 500,
			title: 'Catch-all Error',
			detail: error.stack || error.toString()
		});
	});

	/**********************/

	var web = express.Router();
	this.App.use('/', web);
	web.use(bodyParser.urlencoded({ extended: false }));
	web.get(/^(.*)$/, (req, res) => {
		var options = {
			root: contentDirectory,
			dotfiles: 'deny',
			headers: {
				'X-Timestamp': Date.now(),
				'X-Sent': true
			}
		};

		var fileName = req.params[0] || 'index.html'
		res.sendFile(fileName, options, (err) => {
			if (err) {
			  console.error(`Error sending file: ${err}`);
			  console.error(err);
			  let statusCode = err.status;
			  if (!statusCode || statusCode.toString().match(/^[12345]\d{2}$/)) { statusCode = 500; }
			  res.status(statusCode).end();
			}
			else {
			  this.logger('Sent:', fileName);
			}
		});
	});
};

Server.prototype.Run = function(port) {
	var debug = require('debug')('my-application');
	var http = require('http');

	var httpServer = http.createServer(this.App);
	http.createServer(this.App);

	var server = httpServer.listen(port, function() {
		debug(`Express server listening on port ${server.address().port}`);
	});
};

module.exports = Server;