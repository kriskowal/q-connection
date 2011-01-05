(function (global, require) {
    // this complex example illustrates the symetry of the
    // API and its ability to make long round trips between
    // remote promises and local promises.

    var Q = require("q");
    var COMM = require("q-comm-client");

    // first, we get a "far" promise for the remote object.
    // Because it is a "far" promise, it will never resolve
    // and won't be observable by "when", but you will still
    // be able to asynchronously call methods of the remote
    // object and get promises for the results, even passing
    // promises as arguments.
    var local = Q.def({});
    var remote = COMM.Client(local);

    global.Q = Q;
    global.remote = remote;
    global.local = local;

    console.log("Q is the promise module");
    console.log("remote is an object hosted on the server with a key for every connected client");
    console.log("Use Q.keys(remote) to get a promise for the remote keys.");
    console.log("Use Q.when(keys, function (keys) {...}) to get the result.");
    console.log("Use Q.get(remote, key) to get a promise for an object hosted in a browser.");
    console.log("local is an object hosted in your browser.");
    console.log("Use Q.put(local, 'log', console.log.bind(console)) to add a logging capability to your locally hosted object.");

})(
    this,
    (function (global) {
        return function (id) {
            return global["/" + id];
        };
    })(this)
);
