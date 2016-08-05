var request = require("request");
var fs = require("fs");
var AdmZip = require("adm-zip");
var dir = require("node-dir");
var attr = require("dynamodb-data-types").AttributeValue;
var groupBy = require("lodash.groupby");

var commitToGithub = require("commit-to-github");
var commitOptions = {
	user: "benchmark-gl",
	repo: "benchmark.gl",
	token: process.env.GITHUB_TOKEN,
	fullyQualifiedRef : "heads/master",
	forceUpdate: true,
	commitMessage: "Benchmark Data - " + new Date().getTime().toString()
}

var AWS = require("aws-sdk");
var dynamoDB = new AWS.DynamoDB();

var directory = "/tmp";


var scanDynamoDB = function(query) {
	return new Promise((resolve, reject) => {
		console.log("Downloading benchmark batch...");
		dynamoDB.scan(query, (err, res) => {
			if (err) {
				console.error("scanDynamoDB", JSON.stringify(err, null, "  "));
				return reject(err);
			}
			//TODO: make async
			var jsonOriginal = fs.readFileSync(directory + "/dump.json");
			var json = JSON.parse(jsonOriginal);
			res.Items.forEach(item => {
				json.push(attr.unwrap(item));
			});
			var updatedJson = JSON.stringify(json);
			fs.writeFileSync(directory + "/dump.json", updatedJson);

			if (res.LastEvaluatedKey) { // Result is incomplete; there is more to come.
				query.ExclusiveStartKey = res.LastEvaluatedKey;
				return resolve(scanDynamoDB(query));
			} else {
				return resolve(json);
			}
		});
	});
};

var buildGpuProfileDefinitions = function(benchmarkResults) {
	return new Promise((resolve, reject) => {
		console.log("Building GPU Profiles...");

		var sortedJson = groupBy(benchmarkResults, "system.unmaskedRenderer");

		fs.writeFile(directory + "/dist.json", JSON.stringify(sortedJson), (err) => {
			if(err){
				console.error("outputFiles", JSON.stringify(err, null, "  "));
				return reject(err);
			}
			return resolve();
		});
	});
}

var downloadRepo = function (){
	return new Promise((resolve, reject) => {
		console.log("Downloading repo...");
		request({
				url: "https://github.com/" + commitOptions.user + "/" + commitOptions.repo + "/archive/master.zip",
				method: "GET",
				encoding: null
			})
			.on("error", function(err) {
				console.error("downloadRepo", JSON.stringify(err, null, "  "));
				return reject(err);
			})
			.pipe(fs.createWriteStream(directory + "/bootstrap.zip"))
			.on("close", function () {
				var zip = new AdmZip(directory + "/bootstrap.zip");
				try { 
					zip.extractAllTo(directory, true);
				} catch ( e ) { 
					console.error("downloadRepo", JSON.stringify(e, null, "  "));
					return reject(e);
				}
			 	return resolve();
			});
	});
}

var outputFiles = function (){
	return new Promise((resolve, reject) => {
		console.log("Gathering files...");
		dir.files(directory, function(err, dirFiles) {
			if(err){
				console.error("outputFiles", JSON.stringify(err, null, "  "));
				return reject(err);
			}
			commitFiles = [];
			commitFiles.push({
				path: "dump.json",
				content: fs.readFileSync(directory + "/dump.json","utf8")
			});
			commitFiles.push({
				path: "dist.json",
				content: fs.readFileSync(directory + "/dist.json","utf8")
			});
			return resolve(Object.assign(commitOptions, { files : commitFiles }));
		});
	});
}

exports.handle = function(event, context) {

	var query = {
		"TableName": "gl-benchmark-results",
		"Limit": 10
	};

	fs.writeFileSync(directory + "/dump.json", "[]");
	fs.writeFileSync(directory + "/dist.json", "");

	scanDynamoDB(query)
		.then(buildGpuProfileDefinitions)
		.then(downloadRepo)
		.then(outputFiles)
		.then(commitToGithub)
		.then(context.succeed)
		.catch(error => context.fail({ error: JSON.stringify(error, null, 2) }));
};