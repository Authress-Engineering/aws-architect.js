describe('make.js', () => {
  it('Should be valid node', () => {
    try {
      require('../make');
    } catch (e) {
      console.error(e);
      expect.fail(JSON.stringify(e, null, 2));
    }
  });
});
