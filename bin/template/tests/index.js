'use strict;'
var esprima = require('esprima');
var mocha = require('mocha');
var assert = require('chai').assert;
var fs = require('fs');
var path = require('path');

describe('src/index.js', function() {
	describe('Syntax', function () {
		it('Should be valid Javascript', function() {
			try {
				var userStringToTest = fs.readFileSync(path.resolve('src/index.js'));
				esprima.parse(userStringToTest);
				assert(true);
			}
			catch(e) {
				assert(false, JSON.stringify(e));
			}
		});
		it('Should be valid node', function(){
			try {
				var app = require('../src/index');
				assert(true);
			}
			catch(e) {
				assert(false, JSON.stringify(e));
			}
		});
	});
});