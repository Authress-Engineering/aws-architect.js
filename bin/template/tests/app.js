'use strict;'
var esprima = require('esprima');
var mocha = require('mocha');
var assert = require('chai').assert;
var fs = require('fs');
var path = require('path');

describe('src/app.js', function() {
	describe('Syntax', function () {
		it('Should be valid Javascript', function() {
			try {
				var userStringToTest = fs.readFileSync(path.resolve('src/app.js'));
				esprima.parse(userStringToTest);
				assert(true);
			}
			catch(e) {
				assert(false, JSON.stringify(e));
			}
		});
	});
	describe('Constructor', function () {
		it('Should be able to parse script', function(){
			try {
				var app = require('../src/app');
				assert(true);
			}
			catch(e) {
				assert(false, JSON.stringify(e));
			}
		});
	});
});