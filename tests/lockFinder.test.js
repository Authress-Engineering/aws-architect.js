const path = require('path');
const LockFinder = require('../lib/lockFinder');

describe('lib/lockFinder.js', function() {
  let tests = [
    {
      name: 'find aws-architect lock file.',
      startLocation: __dirname,
      expectedResult: { type: 'yarn', file: path.join(__dirname, '..', 'yarn.lock'), command: 'yarn --prod --frozen-lockfile' }
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
        expect(location).toEqual(test.expectedResult);
      });
    });
  });
});
