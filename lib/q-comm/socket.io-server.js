
var Q = require("q");
var Queue = require("q/queue").Queue;
var COMM = require("../q-comm");

/*
 * @param server is a socket.io server
 */
exports.Server = Server;
function Server(server, object) {
    SocketServer(server, function (connection) {
        COMM.Peer(connection, object);
    });
}

/**
 * @param server is a socket.io server
 */
function SocketServer(server, connect) {
    server.on("connection", function (client) {
        var disconnected = Q.defer();
        var queue = Queue();
        var send = function (message) {
            client.send(message)
        };
        var connection = {
            "get": queue.get,
            "put": function (message) {
                send(message);
            },
            "closed": disconnected.promise
        };
        client.on("message", queue.put);
        client.on("disconnect", function () {
            disconnected.resolve();
            send = function () {
                throw new Error("Disconnected");
            };
        });
        connect(connection);
    });
}

