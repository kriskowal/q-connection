
var Q = require("q");
var COMM = require("q-comm");
var MESSAGES = require("q-comm/messages");

Q.when(MESSAGES.connect(2323, ""), function (connection) {

    var local = Q.def({
        "echo": function (x) {
            return "Goodbye."
        }
    });
    var remote = COMM.Peer(connection, local);
    var shutdown = Q.post(remote, 'shutdown');
    Q.when(shutdown, connection.close);


});
