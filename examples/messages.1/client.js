
var Q = require("q");
var COMM = require("q-comm");
var MESSAGES = require("q-comm/messages");

Q.when(MESSAGES.connect(2323, ""), function (connection) {
    var remote = COMM.Peer(connection);
    var hello = Q.post(remote, 'echo', 'Hello, World!');
    Q.when(hello, function (hello) {
        console.log(hello);
        Q.post(remote, 'quit');
    });
});
