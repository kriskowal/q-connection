
var Q = require("q");
var COMM = require("q-comm");
var MESSAGES = require("q-comm/messages");

MESSAGES.listen(2323, function (connection) {

    var service = Q.def({
        "echo": function (x) {
            return x;
        },
        "quit": function () {
            connection.close();
        }
    });

    COMM.Peer(connection, service);
});

