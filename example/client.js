(function (require) {

    var Q = require("q");
    var COMM = require("q-comm");

    var remote = COMM.Client();

    var local = Q.defer();
    setTimeout(function () {
        local.resolve(Q.def({
            "toString": function () {
                return "Hello, World!"
            }
        }));
    }, 1000);

    var result = Q.post(
        remote,
        'method',
        local.promise
    );
    console.log('called remote method, received promise, waiting...');

    result = Q.post(result, 'toString');

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
