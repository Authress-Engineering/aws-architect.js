'use strict';

var glob = require('glob');

var path = require('path');


describe('Tests', function() {
  describe('setup', function () {
    it('runner', function(){
      var tests = path.join(path.dirname(__filename), 'tests/**/*.js');
      glob(tests, {}, function (er, files) {
        if(er != null) { throw new {detail: 'No test files found in the "test" directory.'}; }
        files.map(function(file) { require(file); });
      });
    });
  });
});

