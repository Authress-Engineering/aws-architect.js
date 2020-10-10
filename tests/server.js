'use strict';
let { describe, it } = require('mocha');
let assert = require('chai').assert;

describe('lib/server.js', () => {
  describe('Syntax', () => {
    it('Should be valid node', () => {
      try {
        require('../lib/server');
        assert(true);
      } catch (e) {
        console.error(e);
        assert(false, JSON.stringify(e, null, 2));
      }
    });
  });
});
