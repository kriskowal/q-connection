
// most of this file concerns the creation of a web
// server and a socket.io server. skip down to XXX XXX
// to see the q-comm code...

var PROCESS = process;
var COMM = require("../../lib/q-comm/socket.io-server");
var Q = require("q-util");
var SOCKET_IO = require("socket.io");
var HTTP = require("q-http");
var JAQUE = require("jaque");
var UTIL = require("n-util");

var port = 8080;

// create a JSGI app that serves up the index and scripts
var app = JAQUE.Branch({
    "": JAQUE.File("www/index.html"),
    "index.html": JAQUE.PermanentRedirect("/"),
    "q-comm.js": JAQUE.File("../../lib/q-comm.js"),
    "q-comm-client.js": JAQUE.File("../../lib/q-comm/socket.io-client.js"),
    "index.js": JAQUE.File("client.js")
}, JAQUE.FileTree("www"))
// create a JSGI server
var server = HTTP.Server(JAQUE.Decorators([
    JAQUE.Error,
    JAQUE.Log,
    JAQUE.ContentLength
], app));

// start a socket.io server on the same node server
var socketIo = SOCKET_IO.listen(server.nodeServer);

// start the JSGI server
Q.when(server.listen(port), function () {
    console.log("Listining on " + port);

    // XXX XXX
    // this attaches a q-comm root object
    // to the socket.io server
    COMM.Server(socketIo, Q.def({
        "identity": function (arg) {
            console.log("local method called");
            return arg;
        }
    }));
    // XXX XXX

}, Q.error);

