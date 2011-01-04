
var Q = require("q");
var COMM = require("q-comm");
var MESSAGES = require("q-comm/messages");

Q.when(MESSAGES.connect(2323, ""), function (connection) {

    var local = Q.def({
        "echo": function (x) {
            return x
        }
    });

    var remote = COMM.Peer(connection, local);

});
