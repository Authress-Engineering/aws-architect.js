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
				console.log(e.stack);
				assert(false, e.toString());
			}
		});
		it('Should be valid node', function(){
			try {
				var app = require('../src/index');
				assert(true);
			}
			catch(e) {
				console.log(e.stack);
				assert(false, e.toString());
			}
		});
	});
	describe('Test Handler', function () {
		it('GET', function() {
			try {
				var api = require('../src/index');

				var result = api.Routes['GET']['/test'].Handler();
				assert.deepEqual(result, {Value: 1}, 'Expected GET /test to return value of 1.')
			}
			catch(e) {
				console.error(e.stack);
				assert(false, e.toString());
			}
		});
	});
});