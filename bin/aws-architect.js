#!/usr/bin/node

var commander = require('commander');
var fs = require('fs-extra');
var path = require('path');

var version = require(path.join(__dirname, '../package.json')).version;
commander.version(version);

var displayHeader = () => {
	console.log('AWS Architect (%s)', version);
	console.log('---------------------------');
};

commander
	.command('init')
	.description('Setup microservice package from template.')
	.action(() => {
		displayHeader();
		console.log("Creating new microservice.");
		console.log('');

		new Promise((s, f) => {
			fs.copy(path.join(__dirname, 'template'), path.resolve('.'), (error) => {
				return error ? f({Error: error.stack || error}) : s({Result: `Template copied to ${path.resolve('.')}`});
			});
		})
		.then((result) => console.log(JSON.stringify(result, null, 2)))
		.catch((result) => console.log(JSON.stringify(result, null, 2)));
	});

commander.on('*', () => {
	if(commander.args.join(' ') == 'tests/**/*.js') { return; }
	displayHeader();
	console.log('Unknown Command: ' + commander.args.join(' '));
	commander.help();
	process.exit(0);
});

commander.parse(process.argv[2] ? process.argv : process.argv.concat(['init']));