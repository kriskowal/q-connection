
// most of this file concerns the creation of a web
// server and a socket.io server. skip down to XXX XXX
// to see the q-comm code...

var PROCESS = process;
var COMM = require("q-comm");
var CONN = require("q-comm/socket.io-server");
var Q = require("q-util");
var SOCKET_IO = require("socket.io");
var HTTP = require("q-http");
var JAQUE = require("jaque");
var UTIL = require("n-util");
var UUID = require("uuid");

var port = 8080;

// create a JSGI app that serves up the index and scripts
var app = JAQUE.Branch({
    "": JAQUE.File("../common-www/index.html"),
    "index.html": JAQUE.PermanentRedirect("/"),
    "q-comm.js": JAQUE.File("../../lib/q-comm.js"),
    "q-comm-client.js": JAQUE.File("../../lib/q-comm/socket.io-client.js"),
    "index.js": JAQUE.File("client.js")
}, JAQUE.FileTree("../common-www"))
// create a JSGI server
var server = HTTP.Server(JAQUE.Decorators([
    JAQUE.Error,
    JAQUE.Log,
    JAQUE.ContentLength
], app));

// start a socket.io server on the same node server
var socketIo = SOCKET_IO.listen(server.nodeServer);

var swarm = Q.def({});

// start the JSGI server
Q.when(server.listen(port), function () {
    console.log("Listining on " + port);

    // XXX
    // we receive a connection object for each
    // browser that succesfully connects back to us.
    CONN.Server(socketIo, function (connection) {
        // We then forge an object-to-object connection
        // between our swarm object and the client
        // object.
        var client = COMM.Peer(connection, swarm);
        var id = UUID.generate();
        // we add the client connection to our
        // swarm table
        Q.put(swarm, id, client);
        // and remove it when the connection closes
        Q.when(connection.closed, function () {
            Q.del(swarm, id);
        });
        // we're using the Q API to manipulate the
        // contents of the def-wrapped swarm object,
        // which isn't strictly necessary since we're
        // local, but it works fine.
    });
    // XXX

}, Q.error);

