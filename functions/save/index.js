var AWS = require("aws-sdk");
var uuid = require("uuid");
var dynamodb = new AWS.DynamoDB();
var attr = require("dynamodb-data-types").AttributeValue;

var tableName = "gl-benchmark-results";

exports.handle = function(event, context) {
	console.log(JSON.stringify(event, null, "  "));

	var datetime = new Date().getTime().toString();

	var gpu = event.gpu || {};
	var benchmarks = event.benchmarks || {};
	var platform = event.platform || {};
	
	var item = {
		"id": uuid.v4(),
		"datetime": datetime,
		"gpu": gpu,
		"benchmarks": benchmarks,
		"platform": platform
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