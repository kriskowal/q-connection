(function (require) {
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
    var remote = COMM.Client();

    // so, to illustrate that bit about using
    // promises as arguments, we construct a promise
    // to use as an argument, which will be resolved
    // in one second.
    var local = Q.defer();
    setTimeout(function () {
        // but to make things more fun, instead of
        // resolving to a literal string, we'll resolve
        // to an unserializable object with a "toString"
        // method.  This means that the resolved
        // object will never be transmitted to the
        // server, nor transmitted back, and that
        // the "toString" method will have to be called
        // on the promise to get a serializable
        // result.
        local.resolve(Q.def({
            "toString": function () {
                return "Hello, World!"
            }
        }));
    }, 1000);

    // then, we call the "identity" method of the remote
    // object, passing the promise for the "Hello, World!"
    // stringable object as an argument.
    var result = Q.post(
        remote,
        'identity',
        local.promise
    );
    console.log('called remote method, received promise, waiting...');

    // then, we pipeline a call to the "toString" method of
    // the result.  The server will be notified that we are
    // interested in the result long before the result
    // becomes available, so we don't wait another round
    // trip for the result.
    result = Q.post(result, 'toString');

    // the result is now a promise for "Hello, World!" as a
    // literal string.  In one second, our local promise
    // will get resolved, which will cause the server to be
    // notified that it can now send messages to that
    // object, which will cause the server to finally send
    // the enqueued "toString" method call message back to
    // our local promise, which will then send a string back
    // to the server, which will be forwarded back to this
    // result promise.
    Q.when(result, function (resolution) {
        console.log('full round trip...');
        console.log(resolution);
    }, function (reason) {
        console.error(reason);
    });

})(
    (function (global) {
        return function (id) {
            return global["/" + id];
        };
    })(this)
);
