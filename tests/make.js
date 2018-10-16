let { describe, it } = require('mocha');
let assert = require('chai').assert;

describe('make.js', () => {
	it('Should be valid node', () => {
		try {
			require('../make');
			assert(true);
		} catch (e) {
			console.error(e);
			assert(false, JSON.stringify(e, null, 2));
		}
	});
});
