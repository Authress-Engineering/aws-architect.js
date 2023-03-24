'use strict';
let path = require('path');
let fs = require('fs-extra');

module.exports = function LockFinder() {
  let findLockFile = async directory => {
    if (!directory || directory === '/' || directory === '' || directory.match(/^[a-zA-Z]:\\$/)) { return null; }

    let yarnLockFile = path.join(directory, 'yarn.lock');
    let packageLockFile = path.join(directory, 'package-lock.json');
    let pnpmLockFile = path.join(directory, 'pnpm-lock.yaml');
    try {
      if (await fs.pathExists(yarnLockFile)) {
        return { type: 'yarn', file: yarnLockFile, command: 'yarn --prod --frozen-lockfile' };
      }
      if (await fs.pathExists(packageLockFile)) {
        return { type: 'npm', file: packageLockFile, command: 'npm install --production' };
      }
      if (await fs.pathExists(pnpmLockFile)) {
        return { type: 'pnpm', file: pnpmLockFile, command: 'pnpm --prod --frozen-lockfile' };
      }

      return await findLockFile(path.join(directory, '..'));
    } catch (error) {
      return { command: 'npm install --production' };
    }
  };

  this.findLockFile = findLockFile;
};
