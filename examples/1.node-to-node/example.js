
var Server = require("websocket-server").Server;
var WebSocket = require("websocket-client").WebSocket;
var QComm = require("../../../q-comm");

var Connection = QComm.Connection;

var port = 126787;

var server = new Server();

// server side
server.on("connection", function (connection) {

    // adapt the connection to a port interface
    var port = {
        postMessage: function (message) {
            connection.send(message)
        },
        onmessage: null
    };
    connection.on("message", function (data) {
        port.onmessage({data: data});
    });

    // provide a local object as the basis for our
    // service.  it can say hi, and the client
    // can shut the server down
    var local = {
        hello: function (myNameIs) {
            return "Hello, " + myNameIs + "!";
        },
        shutdown: function () {
            connection.close();
            server.close();
        }
    };

    // connect the client to our server-side object
    Connection(port, local);

});

// client side
server.on("listening", function () {
    var connection = new WebSocket("ws://localhost:" + port);
    connection.on("open", function () {

        // adapt the connection to a port interface
        var port = {
            postMessage: function (message) {
                connection.send(message);
            },
            onmessage: null
        };
        connection.onmessage = function (event) {
            port.onmessage(event);
        };

        // get a promise for the server-side api
        var remote = Connection(port);

        remote.invoke("hello", "World")
        .then(function (response) {
            console.log("Server said:", response);

            server.close();
            connection.close();
            return remote.invoke("shutdown")
        })
        .end();

    });
});

server.listen(port);

