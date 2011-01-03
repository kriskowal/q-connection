(function (require) {

    var Q = require("q");
    var COMM = require("q-comm-client");

    // first, we get a "far" promise for the remote
    // object.  Because it is a "far" promise, it will
    // never resolve and won't be observable by "when",
    // but you will still be able to asynchronously call
    // methods of the remote object and get promises for
    // the results.
    var remote = COMM.Client();

    // then we call the "identity" method of the
    // remote object, passing "Hello, World!" as
    // an argument. The identity method returns
    // the argument, so we'll receive a promise
    // for "Hello, World!" once it has made a round
    // trip from here to the server and back.
    var result = Q.post(
        remote,
        'identity',
        'Hello, World!'
    );

    // once we get "Hello, World!" back from the
    // server, we log it here.
    Q.when(result, function (resolution) {
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
