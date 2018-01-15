'use strict';
let path = require('path');
let fs = require('fs-extra');

module.exports = function LockFinder() {

	let findLockFile = directory => {
		if (!directory || directory === '/' || directory === '') { return null; }
	
		let yarnLockFile = path.join(directory, 'yarn.lock');
		let packageLockFile = path.join(directory, 'package-lock.json');
		return fs.pathExists(yarnLockFile)
		.then(exists => {
			return exists ? yarnLockFile : fs.pathExists(packageLockFile)
			.then(exists => {
				return exists ? packageLockFile : findLockFile(path.join(directory, '..'));
			});
		})
		.catch(() => null);
	};

	this.findLockFile = findLockFile;
};