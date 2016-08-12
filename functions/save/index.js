var AWS = require("aws-sdk");
var uuid = require("uuid");
var dynamodb = new AWS.DynamoDB();
var attr = require("dynamodb-data-types").AttributeValue;

var tableName = "gl-benchmark-results";

exports.handle = function(event, context) {
	var datetime = new Date().getTime().toString();

	var gpu = event.gpu || {};
	var benchmarks = event.benchmarks || [];
	var platform = event.platform || {};
	var mechTurkId = event.mechTurkId || {};

	//non unique arrays to maps to prevent attr marking them as unique sets
    gpu.aliasedLineWidthRange = Object.assign({}, gpu.aliasedLineWidthRange);
    gpu.aliasedPointSizeRange = Object.assign({}, gpu.aliasedPointSizeRange);
    gpu.maxViewportDimensions = Object.assign({}, gpu.maxViewportDimensions);
    benchmarks.forEach(item => {
        item.stats.sample = Object.assign({}, item.stats.sample)
	});
	
	var item = {
		"id": uuid.v4(),
		"datetime": datetime,
		"gpu": gpu,
		"benchmarks": benchmarks,
		"platform": platform,
		"mechanical-turk-id": mechTurkId
	};
	dynamodb.putItem({
		"TableName": tableName,
		"Item" : attr.wrap(item)
	}, function(err, data) {
		if (err) {
			console.error("bad " + JSON.stringify(err, null, "  "));
			context.fail("error","putting item into dynamodb failed: " + err);
		}
		else {
			console.log("success: " + JSON.stringify(data, null, "  "));
			context.succeed("success!");
		}
	});
};