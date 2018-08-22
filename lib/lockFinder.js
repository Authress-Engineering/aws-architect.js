'use strict';
let path = require('path');
let fs = require('fs-extra');

module.exports = function LockFinder() {
	let findLockFile = directory => {
		if (!directory || directory === '/' || directory === '' || directory.match(/^[a-zA-Z]:\\$/)) { return null; }
	
		let yarnLockFile = path.join(directory, 'yarn.lock');
		let packageLockFile = path.join(directory, 'package-lock.json');
		return fs.pathExists(yarnLockFile)
		.then(exists => {
			return exists ? { type: 'yarn', file: yarnLockFile } : fs.pathExists(packageLockFile)
			.then(npmExists => {
				return npmExists ? { type: 'npm', file: packageLockFile } : findLockFile(path.join(directory, '..'));
			});
		})
		.catch(() => null);
	};

	this.findLockFile = findLockFile;
};
