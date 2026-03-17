'use strict';

describe('lib/server.js', () => {
  describe('Syntax', () => {
    it('Should be valid node', () => {
      try {
        require('../lib/server');
      } catch (e) {
        console.error(e);
        expect.fail(JSON.stringify(e, null, 2));
      }
    });
  });
});
