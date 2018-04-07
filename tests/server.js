'use strict';
let { describe, it } = require('mocha');
let assert = require('chai').assert;

describe('lib/server.js', function() {
	describe('Syntax', function () {
		it('Should be valid node', function(){
			try {
				let app = require('../lib/server');
				assert(true);
			}
			catch(e) {
				console.error(e);
				assert(false, JSON.stringify(e, null, 2));
			}
		});
	});
});