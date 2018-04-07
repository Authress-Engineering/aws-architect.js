let { describe, it } = require('mocha');
let assert = require('chai').assert;

describe('index.js', function() {
	describe('Syntax', function () {
		it('Should be valid node', function(){
			try {
				let app = require('../index');
				assert(true);
			}
			catch(e) {
				console.error(e);
				assert(false, JSON.stringify(e, null, 2));
			}
		});
	});
});