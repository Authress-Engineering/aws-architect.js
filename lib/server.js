'use strict';

let bodyParser = require('body-parser');
let cookieParser = require('cookie-parser');
let express = require('express');
let morgan = require('morgan');
let normalizeHeaderCase = require('header-case-normalizer');

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
	this.App = express();
	//Logger
	this.App.use(morgan('dev'));
	this.App.use(cookieParser());

	// Log every request to the console.
	this.App.use((req, res, next) => {
		this.logger('********************************************************************************');
		fixHeaders(req.headers);
		this.logger(`Request Headers: ${JSON.stringify(req.headers, null, 2)}`);
		this.logger('----------------------------------');
		next();
	});

	/**********************/
	/*		 API		*/

	let events = express.Router();
	events.use(bodyParser.json({ type: '*/*' }));
	this.App.use('/triggers/', events);
	events.post('/event', (req, res) => {
		this.logger(`New Event: ${JSON.stringify(req.body, null, 2)}`);
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
			let resultPromise = lambdaApi.onEvent(req.body, context);
			if (!resultPromise) {
				return res.status(200).json({});
			}

			return Promise.resolve(resultPromise)
			.then(result => {
				return res.status(200).json(result);
			}, failure => {
				return res.status(500).json(failure);
			});
		} catch (exception) {
			this.logger(JSON.stringify({ title: 'Exception thrown by invocation of the runtime event function, check the implementation.', error: exception }, replaceErrors, 2));
			let body = exception instanceof Error ? exception.toString() : exception;
			return res.status(500).json({ title: 'Internal Error, check logs', error: body });
		}
	});
	events.post('/schedule', (req, res) => {
		this.logger(`New Schedule: ${JSON.stringify(req.body)}`);
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
			let resultPromise = lambdaApi.onSchedule(req.body, context);
			if (!resultPromise) {
				return res.status(200).json({});
			}

			return Promise.resolve(resultPromise)
			.then(result => {
				return res.status(200).json(result);
			}, failure => {
				return res.status(500).json(failure);
			});
		} catch (exception) {
			this.logger(JSON.stringify({ title: 'Exception thrown by invocation of the runtime event function, check the implementation.', error: exception }, replaceErrors, 2));
			let body = exception instanceof Error ? exception.toString() : exception;
			return res.status(500).json({ title: 'Internal Error, check logs', error: body });
		}
	});

	let api = express.Router();
	this.App.use('/api/', api);

	api.use(bodyParser.json({ type: '*/*' }));
	api.use((error, req, res, next) => {
		res.status(400).send({ error: 'Invalid JSON' });
	});

	api.get('/', (req, res, next) => {
		try {
			Promise.resolve({})
			.then(() => {
				res.status(400).send({
					title: 'The top level route is not allowed.'
				});
				res.end();
			})
			.catch(error => {
				let message = `Error: ${error}`;
				console.error(message);
				res.status(400).send(message);
			});
		} catch (exception) {
			let message = `Error: ${exception}`;
			console.error(message);
			res.status(500).send(message);
		}
	});

	Object.keys(lambdaApi.Routes || []).map(method => {
		Object.keys(lambdaApi.Routes[method]).map(resource => {
			let expressResource = resource.replace(/{proxy\+}/, '*').replace(/{([^\{\}]+)}/g, ':$1');
			api.all(expressResource, (req, res) => {
				let event = {
					resource: resource,
					path: req.path,
					httpMethod: req.method,
					headers: req.headers || {},
					queryStringParameters: req.query,
					pathParameters: req.params || {},
					body: req.body,
					stageVariables: { lambdaVersion: 'local' }
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

				let callback = (_, response) => {
					this.logger(`StatusCode: ${response.statusCode}`);
					this.logger(`Headers: ${JSON.stringify(response.headers, null, 2)}`);
					if (response.headers) { res.set(response.headers); }
					if (!response.statusCode) { response.statusCode = 200; }
					try {
						let json = JSON.parse(response.body);
						this.logger(`Body: ${JSON.stringify(json, null, 2)}`);
						return res.status(response.statusCode).json(json);
					} catch (exception) {
						this.logger('Body: Binary');
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
							authorizer: promiseResult.context || {}
						};
						event.requestContext.authorizer.principalId = promiseResult.principalId;

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

	let web = express.Router();
	this.App.use('/', web);
	web.get(/^(.*)$/, (req, res) => {
		try {
			Promise.resolve({})
			.then(() => {
				res.status(200).send({
					routes: [
						'/api/',
						'/triggers/event',
						'/triggers/schedule'
					]
				});
				res.end();
			})
			.catch(error => {
				let message = `Error: ${error}`;
				console.error(message);
				res.status(400).send(message);
			});
		} catch (exception) {
			let message = `Error: ${exception}`;
			console.error(message);
			res.status(500).send(message);
		}
	});
}

Server.prototype.Run = function(port) {
	let debug = require('debug')('my-application');
	let http = require('http');

	let httpServer = http.createServer(this.App);
	http.createServer(this.App);

	let server = httpServer.listen(port, function() {
		debug(`Express server listening on port ${server.address().port}`);
	});
};

module.exports = Server;
