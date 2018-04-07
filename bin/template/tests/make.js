let { describe, it } = require('mocha');
let assert = require('chai').assert;
let fs = require('fs');
let path = require('path');

describe('make.js', function() {
	describe('Syntax', function () {
		it('Should be valid node', function(){
			try {
				let app = require('../make');
				assert(true);
			}
			catch(e) {
				console.log(e.stack);
				assert(false, e.toString());
			}
		});
	});
});