#!/usr/bin/env node

const { program } = require('commander');
let fs = require('fs-extra');
let path = require('path');

let version = require(path.join(__dirname, '../package.json')).version;
program.version(version);

let displayHeader = () => {
	console.log('AWS Architect (%s)', version);
	console.log('---------------------------');
};

program
.command('init')
.description('Setup microservice package from template.')
.action(() => {
	displayHeader();
	console.log('Creating new microservice.');
	console.log('');

	let currentWorkspace = path.resolve('.');
	new Promise((resolve, reject) => {
		fs.copy(path.join(__dirname, 'template'), currentWorkspace, error => {
			return error ? reject({ Error: error.stack || error }) : resolve({ Result: `Template copied to ${path.resolve('.')}` });
		});
	}).then(result => console.log(`success: ${JSON.stringify(result, null, 2)}`))
	.catch(result => console.log(`failure: ${JSON.stringify(result, null, 2)}`));
});

program.on('command:*', () => {
	if (program.args.join(' ') === 'tests/**/*.js') { return; }
	displayHeader();
	console.log(`Unknown Command: ${program.args.join(' ')}`);
	program.help();
	process.exit(0);
});

if (require.main === module) {
	program.parse(process.argv[2] ? process.argv : process.argv.concat(['init']));
}
