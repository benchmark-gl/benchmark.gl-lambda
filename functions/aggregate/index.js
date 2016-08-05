var request = require("request");
var fs = require("fs");
var AdmZip = require("adm-zip");
var dir = require("node-dir");
var attr = require("dynamodb-data-types").AttributeValue;
var groupBy = require('lodash.groupby');

var AWS = require("aws-sdk");
var dynamoDB = new AWS.DynamoDB();

var GitHubApi = require("github");
var github = new GitHubApi();
github.authenticate({
	type: "oauth",
	token: process.env.GITHUB_TOKEN
});

var directory = "/tmp";
var user = "benchmark-gl";
var repo = "benchmark.gl";


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
				url: "https://github.com/socialtables/benchmark.gl/archive/master.zip",
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
		dir.files(directory, function(err, files) {
			if(err){
				console.error("outputFiles", JSON.stringify(err, null, "  "));
				return reject(err);
			}
			//we have an array of files now, so now we can iterate that array
			// files.forEach(function(path) {
			// 	console.log(JSON.stringify(path, null, "  "));
			// });
			return resolve(Object.assign({}, { files : files }));
		});
	});
}

var getReferenceCommit = function (data){
	return new Promise((resolve, reject) => {
		console.log("Getting reference...");
		github.gitdata.getReference({
			user: user,
			repo: repo,
			ref: "heads/master"
		}, (err, res) => {
			if (err) {
				console.error("getReferenceCommit", JSON.stringify(err, null, "  "));
				return reject(err);
			}
			return resolve(Object.assign(data, { referenceCommitSha :  res.object.sha}));
		});
	});
}

var createTree = function (data){
	return new Promise((resolve, reject) => {
		console.log("Creating tree...");
		var files = [];
		files.push({
			path: "dump.json",
			mode: "100644",
			type: "blob",
			content: fs.readFileSync(directory + "/dump.json","utf8")
		});
		files.push({
			path: "dist.json",
			mode: "100644",
			type: "blob",
			content: fs.readFileSync(directory + "/dist.json","utf8")
		});
		github.gitdata.createTree({
			user: user,
			repo: repo,
			tree: files,
			base_tree: data.referenceCommitSha
		}, (err, res) => {
			if (err) {
				console.error("createTree", JSON.stringify(err, null, "  "));
				return reject(err);
			}
			return resolve(Object.assign(data, { newTreeSha :  res.sha}));
		});
	});
}

var createCommit = function (data){
	return new Promise((resolve, reject) => {
		console.log("Creating commit...");
		github.gitdata.createCommit({
			user: user,
			repo: repo,
			message: "Benchmark Data - " + new Date().getTime().toString(),
			tree: data.newTreeSha,
			parents: [data.referenceCommitSha]
		}, (err, res) => {
			if (err) {
				console.error("createCommit", JSON.stringify(err, null, "  "));
				return reject(err);
			}
			return resolve(Object.assign(data, { newCommitSha :  res.sha}));
		});
	});
}

var updateRefrence = function (data){
	return new Promise((resolve, reject) => {
		console.log("Updating reference...");
		github.gitdata.updateReference({
			user: user,
			repo: repo,
			ref: "heads/master",
			sha: data.newCommitSha,
			force: true
		}, (err, data) => {
			if (err) {
				console.error("updateRefrence", JSON.stringify(err, null, "  "));
				return reject(err);
			}
			return resolve();
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

	//console.log(JSON.stringify(event, null, "  "));
	scanDynamoDB(query)
		.then(buildGpuProfileDefinitions)
		.then(downloadRepo)
		.then(outputFiles)
		.then(getReferenceCommit)
		.then(createTree)
		.then(createCommit)
		.then(updateRefrence)
		.then(context.succeed)
		.catch(error => context.fail({ error: JSON.stringify(error, null, 2) }));
};