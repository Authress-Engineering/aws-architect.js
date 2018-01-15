'use strict';
let expect = require('chai').expect;
let path = require('path');
let LockFinder = require('../lib/lockFinder');

describe('lib/lockFinder.js', function() {
	let tests = [
		{
			name: 'find aws-architect lock file.'
		}
	];

	tests.map(test => {
		it(test.name, () => {
			return new LockFinder().findLockFile(__dirname)
			.then(location => {
				expect(location).to.equal(path.join(__dirname, '..', 'yarn.lock'));
			});
		});
	});
});