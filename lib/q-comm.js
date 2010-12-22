// this module can be loaded both as a CommonJS module and
// as a browser script.  If included as a script, it constructs
// a "/q-comm" global property with its API and requires
// "/q" and and "/uuid" to be provided before its execution
// by the epynomous scripts/modules.
(function (require, exports) {

var Q = require("q");
var UUID = require("uuid");

var has = Object.prototype.hasOwnProperty;

/**
 * An infinite queue where (promises for) values can be dequeued 
 * before they are enqueued.
 * 
 * <p>Based on a similar example in Flat Concurrent Prolog, perhaps by
 * Ehud (Udi) Shapiro.
 * 
 * @author Mark S. Miller
 */
// Copyright (C) 2010 Google Inc.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
function Queue() {
    var ends = Q.defer();
    return {
        "put": function (value) {
            var next = Q.defer();
            ends.resolve({
                "head": value,
                "tail": next.promise
            });
            ends.resolve = next.resolve;
        },
        "get": function () {
            var result = Q.get(ends.promise, "head");
            ends.promise = Q.get(ends.promise, "tail");
            return result;
        }
    };
}

function Peer(connection) {
    var remotes = {};
    var locals = {};
    var resolvers = {};

    Q.when(connection.get(), get);
    function get(message) {
        Q.when(connection.get(), get);
        receive(message);
    }

    function receive(message) {
        message = JSON.parse(message);
        if (!locals[message.to])
            throw new Error("No such local promise: " + JSON.stringify(message.to));
        ({
            "resolve": function () {
                resolvers[message.to](decode(message.resolution));
            },
            "send": function () {
                // TODO standardize the means by which arbitrary
                // messages are passed into opaque promise objects
                var local = locals[message.to];
                var response = Q.defer();
                local.emit.apply(local, [
                    message.op,
                    response.resolve
                ].concat(decode(message.args)));
                // if the value is ever resolved, send the
                // fully resolved value across the wire
                Q.when(response.promise, function (resolution) {
                    connection.put(JSON.stringify({
                        "type": "resolve",
                        "to": message.from,
                        "resolution": encode(resolution)
                    }));
                }, function (reason) {
                    connection.put(JSON.stringify({
                        "type": "resolve",
                        "to": message.from,
                        "resolution": {"!": encode(reason)}
                    }));
                });
            }
        }[message.type])();
    }

    function makeLocal(id) {
        if (locals[id])
            return locals[id];
        var deferred = Q.defer();
        resolvers[id] = deferred.resolve;
        locals[id] = deferred.promise;
        return deferred.promise;
    }

    function resolveLocal(id, value) {
        resolvers[id](value);
    }

    // makes a promise that will send all of its
    // events to a remote object
    function makeRemote(id) {
        return Q.Promise({}, function (op, resolve) {
            var localId = UUID.generate();
            var response = makeLocal(localId);
            var args = Array.prototype.slice.call(arguments, 2);
            connection.put(JSON.stringify({
                "type": "send",
                "to": id,
                "from": localId,
                "op": op,
                "args": encode(args)
            }));
            return response;
        });
    }

    function encode(object) {
        if (Q.isPromise(object)) {
            var id = UUID.generate();
            makeLocal(id);
            resolveLocal(id, object);
            return {"@": id};
        } else if (Array.isArray(object)) {
            return object.map(encode);
        } else if (typeof object === "object") {
            var result = {};
            for (var name in object) {
                if (has.call(object, name)) {
                    result[name] = encode(object[name]);
                }
            }
            return result;
        } else {
            return object;
        }
    }

    function decode(object) {
        if (!object) {
            return object;
        } else if (object['!']) {
            return Q.reject(object['!']);
        } else if (object['@']) {
            return makeRemote(object['@']);
        } else if (Array.isArray(object)) {
            return object.map(decode);
        } else if (typeof object === 'object') {
            var newObject = {};
            for (var key in object) {
                if (has.call(object, key)) {
                    var newKey = key;
                    /* TODO mirror in encode
                    if (/^[!@]+$/.exec(key))
                        newKey = key.substring(1);
                    */
                    newObject[newKey] = decode(object[key]);
                }
            }
            return newObject;
        } else {
            return object;
        }
    }

    return {
        "listen": function (object) {
            // sends the root remote object
            // to the client
            makeLocal("");
            resolveLocal("", object);
        },
        "connect": function () {
            // returns a promise for a remote
            // object
            return makeRemote("");
        }
    };

}

/**
 * @returns a promise for the root remote object.
 */
exports.Client = Client;
function Client() {
    var deferred = Q.defer();
    SocketClient(function (connection) {
        var peer = Peer(connection);
        var remote = peer.connect();
        // race to reject or resolve
        deferred.resolve(remote);
        // if it closes before it's resolved
        Q.when(connection.closed, null, deferred.reject);
    });
    return deferred.promise;
}

/*
 * @param server is a socket.io server
 */
exports.Server = Server;
function Server(server, object) {
    SocketServer(server, function (connection) {
        var peer = Peer(connection);
        peer.listen(object);
    });
}

function SocketClient(connect) {
    var socket = new io.Socket();
    var connected = Q.defer();
    var disconnected = Q.defer();
    var queue = Queue();
    var connection = {
        "get": queue.get,
        "put": function (message) {
            socket.send(message);
        },
        "closed": disconnected.promise
    };
    Q.when(connected.promise, connect);
    socket.connect();
    socket.on("connect", function () {
        connected.resolve(connection);
    });
    socket.on("message", queue.put);
    socket.on("disconnect", disconnected.resolve);
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

}).apply(this, typeof exports !== "undefined" ? [
    require, exports
] : [
    (function (global) {
        return function (id) {
            return global["/" + id];
        };
    })(this),
    this["/q-comm"] = {}
]);
