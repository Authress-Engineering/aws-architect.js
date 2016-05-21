'use strict';

var bodyParser = require('body-parser');
var cookieParser = require('cookie-parser');
var express = require('express');
var morgan = require('morgan');
var path = require('path');

function Server(contentDirector, lambdaDirectory, awsConfig) {
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

	[(a,b) => api.options(a,b), (a,b) => api.get(a,b), (a,b) => api.post(a,b), (a,b) => api.patch(a,b), (a,b) => api.put(a,b), (a,b) => api.delete(a,b)].map((func) => {
		func(/.*/, (req, res, next) => {
			res.set({
				'Access-Control-Allow-Origin': req.headers['origin'],
				'Access-Control-Allow-Methods': 'HEAD, POST, PUT, GET, PATCH, DELETE, OPTIONS',
				'Access-Control-Allow-Headers': 'origin, accept, Content-Type, X-Amz-Date, Authorization, X-Api-Key, X-Amz-Security-Token',
				'Access-Control-Allow-Credentials': 'true'
			});
			next();
		});
	})

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


	console.log(awsConfig['lambdas']);
	awsConfig['lambdas'].map((lambda) => {
		var file = path.join(lambdaDirectory, lambda.filename);
		console.log(`Fould Lambda: ${file}: ${lambda.resource}`);

		lambda.verbs.map((verb) => {
			var apiVerb = {
				'GET': (a,b) => api.get(a,b),
				'POST': (a,b) => api.post(a,b),
				'PUT': (a,b) => api.put(a,b),
				'PATCH': (a,b) => api.patch(a,b),
				'DELETE': (a,b) => api.delete(a,b)
			}[verb];
			apiVerb(`/${lambda.resource}`, (req, res) => {
				var aws = require('aws-sdk');
				require(file).handler(res.body, {
					functionName: lambda.filename,
					local: true,
					identity: {
						cognitoIdentityId: 'local',
						cognitoIdentityPoolId: null
					}
				}, (error, result) => {
					if(error) {
						console.log(error);
						var json = JSON.parse(error);
						return res.status(json.statusCode).send(json);
					}
					console.log(result);
					return res.status(200).send(JSON.parse(result));
				});
			});
		});
	});

	api.use((error, req, res, next) => {
		console.error("Catch-all Error: " + JSON.stringify(error));
		res.status(500).send(error);
	});

	/**********************/

	var web = express.Router();
	this.App.use('/web', web);
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