
var Q = require("q");
var Worker = require("webworker").Worker;
var Peer = require("q-comm/webworker").Peer;

var worker = new Worker(__dirname + "/worker.js");
var remote = Peer(worker);

// call the identity method of the remote object.
// this will send "Hello, World!" on a round trip.
var hello = Q.post(remote, "identity", "Hello, World!");
Q.when(hello, function (hello) {
    console.log(hello);
    worker.terminate();
});

