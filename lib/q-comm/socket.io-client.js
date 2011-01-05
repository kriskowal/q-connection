(function (require, exports) {

var Q = require("q");
var Queue = require("q/queue").Queue;
var COMM = require("q-comm");

/**
 * @returns a promise for the root remote object.
 */
exports.Client = Client;
function Client(object) {
    var deferred = Q.defer();
    SocketClient(function (connection) {
        var remote = COMM.Peer(connection, object);
        // race to reject or resolve
        deferred.resolve(remote);
        // if it closes before it's resolved
        Q.when(connection.closed, null, deferred.reject);
    });
    return deferred.promise;
}

function SocketClient(connect) {
    var socket = new io.Socket();
    var connected = Q.defer();
    var disconnected = Q.defer();
    var queue = Queue();
    var connection = {
        "get": queue.get,
        "put": function (message) {
            socket.send(message);
        },
        "closed": disconnected.promise
    };
    Q.when(connected.promise, connect);
    socket.connect();
    socket.on("connect", function () {
        connected.resolve(connection);
    });
    socket.on("message", queue.put);
    socket.on("disconnect", disconnected.resolve);
}

}).apply(this, typeof exports !== "undefined" ? [
    require, exports
] : [
    (function (global) {
        return function (id) {
            return global["/" + id];
        };
    })(this),
    this["/q-comm-client"] = {}
]);
