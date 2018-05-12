/**
 * Module dependencies
 */
let commander = require('commander');
let fs = require('fs-extra');

let travis = require('travis-build-tools')(process.env.GIT_TAG_PUSHER);
let version = travis.GetVersion();
commander.version(version);

/**
 * Build
 */
commander
.command('build')
.description('Setup require build files for npm package.')
.action(async () => {
	let package_metadata = require('./package.json');
	package_metadata.version = version;
	await fs.writeJson('./package.json', package_metadata, { spaces: 2 });

	console.log('Building package %s (%s)', package_metadata.name, version);
	console.log('');
});

/**
 * After Build
 */
commander
.command('after_build')
.description('Publishes git tags and reports failures.')
.action(() => {
	let package_metadata = require('./package.json');
	console.log('After build package %s (%s)', package_metadata.name, version);
	console.log('');
	travis.PublishGitTag();
	travis.MergeDownstream('release/', 'master');
});

commander.on('*', () => {
	if (commander.args.join(' ') === 'tests/**/*.js') { return; }
	console.log(`Unknown Command: ${commander.args.join(' ')}`);
	commander.help();
	process.exit(0);
});
commander.parse(process.argv[2] ? process.argv : process.argv.concat(['build']));