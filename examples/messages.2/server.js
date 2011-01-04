
var Q = require("q");
var COMM = require("q-comm");
var MESSAGES = require("q-comm/messages");

var server = MESSAGES.listen(2323, function (connection) {

    var local = Q.def({
        "shutdown": function () {
            return Q.post(server, "close");
        }
    });

    var remote = COMM.Peer(connection, local);
    var hello = Q.post(remote, "echo", "Hello, World!");
    Q.when(hello, function (hello) {
        console.log(hello);
        connection.close();
    });

});

