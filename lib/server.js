'use strict';

var bodyParser = require('body-parser');
var cookieParser = require('cookie-parser');
var express = require('express');
var morgan = require('morgan');
var path = require('path');

function Server(contentDirectory, lambdaApi) {
	this.App = express();
	//Logger
	this.App.use(morgan('dev'));
	this.App.use(cookieParser());

	// Log every request to the console.
	this.App.use((req, res, next) => {
		console.log("********************************************************************************");
		console.log("Headers: " + JSON.stringify(req.headers));
		req.headers['content-type'] = 'application/json';
		console.log("----------------------------------");

		res.set({
			'Access-Control-Allow-Origin': req.headers['origin'],
			'Access-Control-Allow-Methods': 'HEAD, POST, PUT, GET, PATCH, DELETE, OPTIONS',
			'Access-Control-Allow-Headers': 'origin, accept, Content-Type, X-Amz-Date, Authorization, X-Api-Key, X-Amz-Security-Token',
			'Access-Control-Allow-Credentials': 'true'
		});
		next();
	});

	/**********************/
	/*		 API		*/

	var api = express.Router();
	this.App.use('/api/', api);
	api.use(bodyParser.json());
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

	Object.keys(lambdaApi.Routes).map(method => {
		Object.keys(lambdaApi.Routes[method]).map(resource => {
			var expressResource = resource.replace(/{proxy\+}/, '*').replace(/{([^\{\}]+)}/g, ':$1');
			api.all(expressResource, (req, res) => {
				var event = {
					resource: resource,
					httpMethod: req.method,
					headers: req.headers || {},
					queryStringParameters: req.query,
					pathParameters: req.params || {},
					body: req.body ? JSON.stringify(req.body) : null,
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
					console.log(`Response ${JSON.stringify(response, null, 2)}`);
					res.set(response.headers);
					return res.status(response.statusCode).json(response.body);
				};

				lambdaApi.handler(event, context, callback);
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
			detail: error.stack || error
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
				'x-timestamp': Date.now(),
				'x-sent': true
			}
		};

		var fileName = req.params[0] || 'index.html'
		res.sendFile(fileName, options, (err) => {
			if (err) {
			  console.error(err);
			  res.status(err.status).end();
			}
			else {
			  console.log('Sent:', fileName);
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