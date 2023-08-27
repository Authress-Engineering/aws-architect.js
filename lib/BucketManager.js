let fs = require('fs-extra');
let glob = require('glob');
let path = require('path');
const { createHash } = require('crypto');
const { lookup } = require('mime-types');

const contentTypeMappingConst = {
  '.ico': 'image/x-icon',
  '.ttf': 'application/font-sfnt',
  '.woff': 'application/font-woff'
};

class BucketManager {
  constructor(s3Manager, bucket) {
    this.S3Manager = s3Manager;
    this.Bucket = bucket ? bucket : null;
  }

  async deletePath(directory) {
    const params = {
      Bucket: this.Bucket,
      Prefix: directory.slice(-1) === '/' ? directory : `${directory}/`
    };
    const result = await this.S3Manager.listObjectsV2(params).promise();
    await Promise.all(result.Contents.map(async object => {
      await this.S3Manager.deleteObject({ Bucket: this.Bucket, Key: object.Key }).promise();
    }));
  }

  async Deploy(contentPath, rawVersion, cacheControlRegexMap = [], contentTypeMappingOverride = {}) {
    const version = rawVersion || '';
    let contentTypeMapping = Object.assign({}, contentTypeMappingConst, contentTypeMappingOverride || {});
    console.log('Deploying Website');

    const uploadFile = async (file/*, directoryHasOtherFilesMap */) => {
      let relativePath = path.relative(path.resolve(contentPath), path.resolve(file));
      let relativePathUnixFormat = this.unixify(relativePath);
      let matchingCacheMap = Array.isArray(cacheControlRegexMap) && cacheControlRegexMap.find(m =>
        !m.explicit && !m.regex || m.explicit === relativePathUnixFormat || m.regex && m.regex.test(relativePath)
      );
      let cacheControl = matchingCacheMap && matchingCacheMap.value || cacheControlRegexMap[relativePathUnixFormat] || cacheControlRegexMap.default || 600;
      const fileUrl = this.unixify(path.join(version, relativePath));
      const fileData = await fs.readFile(file);

      const putObjectParams = {
        Bucket: this.Bucket,
        Key: fileUrl,
        Body: fileData,
        ContentMD5: createHash('md5').update(fileData).digest('base64'),
        Metadata: {
          Hash: createHash('md5').update(fileData).digest('base64')
        },
        ContentType: contentTypeMapping[relativePath] || contentTypeMapping[path.extname(file)] || lookup(file) || contentTypeMapping.default || 'text/plain',
        CacheControl: typeof cacheControl === 'number' ? `public, max-age=${cacheControl}` : cacheControl
      };
      try {
        await this.putObjectIfDifferent(putObjectParams);
        console.log(`====> ${fileUrl}`);
        // Also upload a redirect file pointing one place below and duplicate the file at /
        const unixifiedIndexFilePath = this.unixify(relativePath);
        if (unixifiedIndexFilePath.match(/\.html$/) && unixifiedIndexFilePath !== 'index.html') {
          // First duplicate the file at the "/" location
          // Then add a redirect from the base location to the "/" by duplicating the file again, this way `/route`, `/route/`, and `/route/index.html` all point to `/route/index.html`
          const redirectFileUrl = unixifiedIndexFilePath.replace(/\/index.html$/, '').replace(/\.html$/, '');
          putObjectParams.Body = fileData;
          putObjectParams.Key = `${this.unixify(path.join(version, redirectFileUrl))}/`;
          await this.putObjectIfDifferent(putObjectParams);
          console.log(`   => ${putObjectParams.Key} (Handler with: /)`);

          putObjectParams.Body = fileData;
          putObjectParams.Key = `${this.unixify(path.join(version, redirectFileUrl))}`;
          await this.putObjectIfDifferent(putObjectParams);
          console.log(`   => ${putObjectParams.Key} (Handler without: /)`);
        }
      } catch (failure) {
        throw { File: file, Error: failure.stack || failure.toString(), Detail: failure };
      }
    };

    const list = await new Promise((resolve, reject) => {
      glob(path.join(contentPath, '**'), { nonull: true, dot: true, nodir: true },
        (error, files) => error ? reject({ Title: 'Failed to get list of content files', Error: error.stack || error.toString(), Detail: error }) : resolve(files)
      );
    });

    let sortedList = list.filter(file => !file.match('index.html'));
    await Promise.all(sortedList.map(file => uploadFile(file)));

    const fileCountsPerDirectoryMap = {};
    for (const file of sortedList) {
      const splitFile = file.split('/').slice(0, -1).join('/');
      fileCountsPerDirectoryMap[splitFile] = true;
    }
    let indexList = list.filter(file => file.match('index.html')).sort((a, b) => b.split('/').length - a.split('/').length);
    await Promise.all(indexList.map(file => uploadFile(file, fileCountsPerDirectoryMap)));

    return { Title: 'Upload Success.', Bucket: this.Bucket, Version: version };
  }

  async putObjectIfDifferent(params) {
    try {
      const currentObject = await this.S3Manager.headObject({ Bucket: params.Bucket, Key: params.Key }).promise();
      if (currentObject && currentObject.Metadata && currentObject.Metadata.Hash === params.Metadata.Hash) {
        return;
      }
    } catch (error) {
      /* */
    }
    await this.S3Manager.putObject(params).promise();
  }

  async DeployLambdaPromise(bucket, localPath, remotePath) {
    await this.ensureBucketExists(bucket || this.Bucket);

    try {
      await this.S3Manager.upload({
        Bucket: bucket || this.Bucket,
        Key: this.unixify(remotePath),
        Body: fs.createReadStream(localPath),
        ContentType: contentTypeMappingConst[path.extname(remotePath)] || lookup(remotePath) || contentTypeMappingConst.default || 'text/plain',
        CacheControl: 'public, max-age=10'
      }).promise();
      console.log(`====> ${remotePath}`);
    } catch (failure) {
      throw { File: localPath, Detail: failure };
    }
  }

  CopyBucket(source, target) {
    let listParams = {
      Bucket: this.Bucket,
      Delimiter: ',',
      EncodingType: 'url',
      //FetchOwner: true || false,
      //MaxKeys: 0
      Prefix: source
    };
    return this.S3Manager.listObjectsV2(listParams).promise()
    .then(data => {
      if (data.IsTruncated) { throw ({ Title: 'Failed to copy source', Error: 'Too many objects present.' }); }
      return data.Contents.map(item => item.Key).filter(key => !key.match(/\/$/)).reduce((listPromise, key) => {
        return listPromise.then(() => {
          return this.S3Manager.copyObject({
            Bucket: this.Bucket,
            Key: this.unixify(path.join(target, path.relative(source, key))),
            CopySource: `${this.Bucket}/${this.unixify(key)}`
          }).promise()
          .catch(failure => {
            throw { Source: key, Error: failure.stack || failure.toString(), Detail: failure };
          });
        }).then(() => ({ Title: 'Promote to stage success', Bucket: this.Bucket, Source: source, Target: target }));
      }, Promise.resolve([]));
    });
  }

  async ensureBucketExists(bucket) {
    const bucketLifecycleConfigurationParams = {
      Bucket: bucket,
      LifecycleConfiguration: {
        Rules: [{
          ID: 'AutoDeleteOldArtifacts',
          Expiration: {
            Days: 365
          },
          Prefix: '',
          NoncurrentVersionExpiration: {
            NoncurrentDays: 5
          },
          AbortIncompleteMultipartUpload: {
            DaysAfterInitiation: 5
          },
          Status: 'Enabled'
        }]
      }
    };

    try {
      await this.S3Manager.headBucket({ Bucket: bucket }).promise();
    } catch (error) {
      if (error.code !== 'NotFound') {
        throw { title: 'Failed to validate deployment bucket is available', error, bucket };
      }

      const params = { Bucket: bucket };
      if (this.S3Manager.config.region !== 'us-east-1') {
        params.CreateBucketConfiguration = { LocationConstraint: this.S3Manager.config.region };
      }
      await this.S3Manager.createBucket(params).promise();
      await this.S3Manager.putPublicAccessBlock({
        Bucket: bucket, PublicAccessBlockConfiguration: { BlockPublicAcls: true, BlockPublicPolicy: true, IgnorePublicAcls: true, RestrictPublicBuckets: true }
      }).promise();
      await this.S3Manager.putBucketLifecycleConfiguration(bucketLifecycleConfigurationParams).promise();
    }
  }

  // Ensures a path will be in unix format (that is, forward slash), also on Windows systems.
  // * On windows the nodejs "path" library incorrectly uses backlash (\) even when we aren't writing to the filesystem. So this fixes the paths since we are writing to S3 in this class
  unixify(fullPath) {
    return fullPath.replace(/\\/g, '/');
  }
}

module.exports = BucketManager;
