
var PROCESS = process;
var COMM = require("../lib/q-comm");
var Q = require("q-util");
var SOCKET = require("socket.io");
var HTTP = require("q-http");
var JAQUE = require("jaque");
var UTIL = require("n-util");

var port = 8080;

var app = JAQUE.Branch({
    "": JAQUE.File("www/index.html"),
    "index.html": JAQUE.PermanentRedirect("/"),
    "q-comm.js": JAQUE.File("../lib/q-comm.js"),
    "index.js": JAQUE.File("client.js")
}, JAQUE.FileTree("www"))

var server = HTTP.Server(JAQUE.Decorators([
    JAQUE.Error,
    JAQUE.Log,
    JAQUE.ContentLength
], app));

var webSocket = SOCKET.listen(server.nodeServer);

Q.when(server.listen(port), function () {
    console.log("Listining on " + port);

    COMM.Server(webSocket, {
        "method": function (arg) {
            console.log("local method called");
            return arg;
        }
    });

    var siginted;
    PROCESS.on("SIGINT", function () {
        if (siginted)
            throw new Error("Force-stopped.");
        siginted = true;
        Q.when(server.stop(), function () {
            console.log("Server stopped");
        });
    });

}, Q.error);

