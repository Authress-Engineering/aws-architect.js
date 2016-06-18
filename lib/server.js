'use strict';

var bodyParser = require('body-parser');
var cookieParser = require('cookie-parser');
var express = require('express');
var morgan = require('morgan');
var path = require('path');

function Server(contentDirectory, lambdaFile, awsConfig) {
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

	awsConfig['lambdas'].map((lambda) => {
		var file = lambdaFile;
		console.log(`Found Lambda: ${file}: ${lambda.resource}`);

		lambda.verbs.map((verb) => {
			var apiVerb = {
				'HEAD': (a,b) => api.head(a,b),
				'GET': (a,b) => api.get(a,b),
				'POST': (a,b) => api.post(a,b),
				'PUT': (a,b) => api.put(a,b),
				'PATCH': (a,b) => api.patch(a,b),
				'DELETE': (a,b) => api.delete(a,b)
			}[verb];
			apiVerb(`/${lambda.resource}`, (req, res) => {
				var aws = require('aws-sdk');
				var lambdaFunction;
				try {
					lambdaFunction = require(file);
				}
				catch (exception) {
					console.error(exception.stack || exception);
					return res.status(500).json({
						title: `Failed to execute lambda: ${file}`,
						error: exception.stack || exception
					});
				}
				lambdaFunction.handler(res.body, {
					functionName: file,
					local: true,
					identity: {
						cognitoIdentityId: 'local',
						cognitoIdentityPoolId: null
					}
				}, (error, result) => {
					if(error) {
						console.error(error);
						var json = JSON.parse(error);
						return res.status(json.statusCode).json(json);
					}
					console.log(result);
					return res.status(200).json(JSON.parse(result));
				});
			});
		});
	});

	api.use((error, req, res, next) => {
		console.error(`Catch-all Error: ${error.stack || error} -${JSON.stringify(error)}`);
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

Server.prototype.Run = function() {
	var debug = require('debug')('my-application');
	var http = require('http');

	var httpServer = http.createServer(this.App);
	http.createServer(this.App);

	var server = httpServer.listen(80, function() {
		debug(`Express server listening on port ${server.address().port}`);
	});
};

module.exports = Server;