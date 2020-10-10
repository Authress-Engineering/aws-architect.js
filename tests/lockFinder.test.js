
const { describe, it } = require('mocha');
const { expect } = require('chai');
const path = require('path');
const LockFinder = require('../lib/lockFinder');

describe('lib/lockFinder.js', function() {
  let tests = [
    {
      name: 'find aws-architect lock file.',
      startLocation: __dirname,
      expectedResult: { type: 'yarn', file: path.join(__dirname, '..', 'yarn.lock') }
    },
    {
      name: 'Does not find aws-architect lock file.',
      startLocation: path.join(__dirname, '../..'),
      expectedResult: null
    }
  ];

  tests.map(test => {
    it(test.name, () => {
      return new LockFinder().findLockFile(test.startLocation)
      .then(location => {
        expect(location).to.eql(test.expectedResult);
      });
    });
  });
});
