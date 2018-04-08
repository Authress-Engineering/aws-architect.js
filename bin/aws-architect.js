#!/usr/bin/env node

let commander = require('commander');
let fs = require('fs-extra');
let path = require('path');

let version = require(path.join(__dirname, '../package.json')).version;
commander.version(version);

let displayHeader = () => {
	console.log('AWS Architect (%s)', version);
	console.log('---------------------------');
};

commander
.command('init')
.description('Setup microservice package from template.')
.action(() => {
	displayHeader();
	console.log('Creating new microservice.');
	console.log('');

	let currentWorkspace = path.resolve('.');
	new Promise((s, f) => {
		fs.copy(path.join(__dirname, 'template'), currentWorkspace, (error) => {
			return error ? f({Error: error.stack || error}) : s({Result: `Template copied to ${path.resolve('.')}`});
		});
	}).then(result => {
		/* WTF: https://github.com/npm/npm/issues/7252 */
		return new Promise((s, f) => { fs.move(path.join(currentWorkspace, '.npmignore'), path.join(currentWorkspace, '.gitignore'),
			error => error ? f({Error: 'Error creating .gitignore file', Detail: error}) : s(result)); });
	}).then((result) => console.log(`success: ${JSON.stringify(result, null, 2)}`))
	.catch((result) => console.log(`failure: ${JSON.stringify(result, null, 2)}`));
});

commander.on('*', () => {
	if(commander.args.join(' ') === 'tests/**/*.js') { return; }
	displayHeader();
	console.log('Unknown Command: ' + commander.args.join(' '));
	commander.help();
	process.exit(0);
});

commander.parse(process.argv[2] ? process.argv : process.argv.concat(['init']));