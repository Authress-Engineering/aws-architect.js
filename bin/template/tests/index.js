let { describe, it } = require('mocha');
let assert = require('chai').assert;

describe('src/index.js', function() {
	describe('Test Handler', function () {
		it('GET livecheck', function() {
			try {
				let api = require('../src/index');

				let result = api.Routes['GET']['/livecheck'].Handler();
				let expectedResult = {
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
		it('ANY', function() {
			try {
				let api = require('../src/index');

				let result = api.Routes['ANY']['/{proxy+}'].Handler();
				let expectedResult = {
					statusCode: 404,
					body: JSON.stringify({}),
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
				let lambda = require('../src/index');
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