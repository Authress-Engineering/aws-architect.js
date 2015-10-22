#!/usr/bin/env node
'use strict';

var commander = require('commander');
var fs = require('fs');
//var shell = function(func) { return require('child_process').execSync(func, { encoding: 'utf8' }); };

commander.version(require('./../package.json').version);

commander
	.command('init')
	.description('Setup microservice package from template.')
	.action(function() {
		
		console.log("Creating new microservice.");
		console.log('');
	});

commander
	.command('*')
    .action(function(cmd){
      console.error('Unknown command: %s', cmd);
    });