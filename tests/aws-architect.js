let { describe, it } = require('mocha');

describe('bin/aws-architect.js', () => {
  describe('Syntax', () => {
    it('Should be valid node', () => {
      require('../bin/aws-architect');
    });
  });
});
