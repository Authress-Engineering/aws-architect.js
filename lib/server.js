const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const express = require('express');
const http = require('http');
const morgan = require('morgan');
const normalizeHeaderCase = require('header-case-normalizer');

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
	events.post('/event', async (req, res) => {
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
			let eventHandler = lambdaApi.handlers && lambdaApi.handlers.onEvent || lambdaApi.onEvent;
			let result = await eventHandler(req.body, context);
			return res.status(200).json(result || {});
		} catch (exception) {
			this.logger(JSON.stringify({ title: 'Exception thrown by invocation of the runtime event function, check the implementation.', error: exception }, replaceErrors, 2));
			let body = exception instanceof Error ? exception.toString() : exception;
			return res.status(500).json({ title: 'Internal Error, check logs', error: body });
		}
	});
	events.post('/schedule', async (req, res) => {
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
			let scheduleHandler = lambdaApi.handlers && lambdaApi.handlers.onSchedule || lambdaApi.onSchedule;
			let result = await scheduleHandler(req.body, context);
			return res.status(200).json(result || {});
		} catch (exception) {
			this.logger(JSON.stringify({ title: 'Exception thrown by invocation of the runtime event function, check the implementation.', error: exception }, replaceErrors, 2));
			let body = exception instanceof Error ? exception.toString() : exception;
			return res.status(500).json({ title: 'Internal Error, check logs', error: body });
		}
	});

	let api = express.Router();
	this.App.use('/api/', api);

	api.use(bodyParser.json({ type: '*/*' }));
	/* eslint-disable-next-line no-unused-vars */
	api.use((error, req, res, next) => {
		res.status(400).send({ error: 'Invalid JSON' });
	});

	/* eslint-disable-next-line no-unused-vars */
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
			api.all(expressResource, async (req, res) => {
				let event = {
					resource: resource,
					path: req.path,
					httpMethod: req.method,
					headers: req.headers || {},
					queryStringParameters: req.query,
					pathParameters: req.params || {},
					body: req.body,
					stageVariables: { lambdaVersion: 'local' },
					requestContext: {
						requestId: 'Invoked-from-AwsArchitect'
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
						let authorizerFunc = lambdaApi.Authorizer.AuthorizerFunc || lambdaApi.authorizer || lambdaApi.Authorizer || (() => ({ principalId: '<no-authorizer-func-specified>' }));
						let result = await authorizerFunc(event);
						event.requestContext = {
							authorizer: result.context || {}
						};
						event.requestContext.authorizer.principalId = result.principalId;
					} catch (authorizerError) {
						console.error(authorizerError.stack || authorizerError);
						return res.status(authorizerError === 'Unauthorized' || authorizerError.message === 'Unauthorized' ? 401 : 403).json({
							code: 'Unauthorized',
							title: 'Authorizer returned rejection',
							response: authorizerError.toString()
						});
					}
				}

				try {
					let response = await lambdaApi.handler(event, context);
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
				} catch (exception) {
					return res.status(500).json({
						code: 'AuthorizationRuntimeFailure',
						title: 'Synchronous failure in authorizer',
						error: exception.stack || exception.toString()
					});
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

async function checkPort(port) {
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
	http.createServer(this.App);

	let availablePort = await getNextPort(port);
	let server = httpServer.listen(availablePort);
	return server.address().port;
};

module.exports = Server;
