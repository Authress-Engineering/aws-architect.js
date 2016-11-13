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
		it('ANY', function() {
			try {
				var api = require('../src/index');

				var result = api.Routes['ANY']['/{proxy+}'].Handler();
				var expectedResult = {
					statusCode: 200,
					body: JSON.stringify({
						'field': 'hello world'
					}),
					headers: {
						'Content-Type': 'application/json'
					}
				}
				assert.equal(result.statusCode, expectedResult.statusCode, 'Expected ANY /proxy status code to have matching value.')
				assert.deepEqual(result.headers, expectedResult.headers, 'Expected ANY /proxy headers to have matching value.')
				assert.equal(result.body, expectedResult.body, 'Expected ANY /proxy body to have matching value.')
			}
			catch(e) {
				console.error(e.stack);
				assert(false, e.toString());
			}
		});
	});
	describe('Non-RESTful Test', function () {
		/*
		it('GET', function(done) {
			try {
				var lambda = require('../src/index');
				new Promise((s, f) => {
					lambda({}, {}, (failure, success) => {
						if(success && !failure) { return s(success); }
						else { f(failure); }
					});
				})
				.then(output => {
					done();
				})
				.catch(failure => done(failure));
			}
			catch(e) {
				console.error(e.stack);
				assert(false, e.toString());
			}
		});
		*/
	});
});