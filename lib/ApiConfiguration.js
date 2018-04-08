class ApiConfiguration {
	constructor(options, lambdaFileName, fallbackRegion) {
		if (!(this instanceof ApiConfiguration)) {
			throw new Error('Configurations must be instantiated.');
		}

		let configuration = options || {};
		this.Regions = configuration.regions || [fallbackRegion];
	}
}

module.exports = ApiConfiguration;
