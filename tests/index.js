let { describe, it } = require('mocha');

describe('index.js', () => {
  describe('Syntax', () => {
    it('Should be valid node', () => {
      require('../index');
    });
  });
});
