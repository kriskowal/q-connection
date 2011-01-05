(function (global, require, exports) {

var Q = require("q");
var Queue = require("q/queue").Queue;
var COMM = require("q-comm");

exports.Connection = Connection;
function Connection(worker) {
    var queue = Queue();
    var closed = Q.defer();
    worker.onmessage = function (message) {
        queue.put(message.data);
    };
    return {
        "get": queue.get,
        "put": function (message) {
            worker.postMessage(message);
        },
        "close": closed.resolve,
        "closed": closed.promise
    };
}

exports.Peer = Peer;
function Peer(worker, object) {
    var connection = Connection(worker);
    return COMM.Peer(connection, object);
}

}).apply(
    this,
    typeof exports !== "undefined" ? [
        this,
        require,
        exports
    ] : [
        this,
        (function (global) {
            return function (id) {
                return global["/" + id];
            };
        })(this),
        this["/q-comm/webworker"] = {}
    ]
);
