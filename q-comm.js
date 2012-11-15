var Q = require("q");
var LruMap = require("collections/lru-map");
var Queue = require("./lib/queue");
var UUID = require("./lib/uuid");

function debug() {
    //typeof console !== "undefined" && console.log.apply(console, arguments);
}

var rootId = "";

var has = Object.prototype.hasOwnProperty;

/**
 * @param connection
 * @param local
 */
module.exports = Connection;
function Connection(connection, local, options) {
    options = options || {};
    var makeId = options.makeId || function () {
        return UUID.generate();
    };
    var locals = LruMap(null, options.max || Infinity);
    connection = adapt(connection, options.origin);

    var debugKey = Math.random().toString(16).slice(2, 4).toUpperCase() + ":";
    function _debug() {
        debug.apply(null, [debugKey].concat(Array.prototype.slice.call(arguments)));
    }

    // message reciever loop
    Q.when(connection.get(), get).done();
    function get(message) {
        _debug("receive:", message);
        Q.when(connection.get(), get).done();
        receive(message);
    }

    // message receiver
    function receive(message) {
        message = JSON.parse(message);
        if (!receivers[message.type])
            return; // ignore bad message types
        if (!locals.has(message.to))
            return; // ignore messages to non-existant or forgotten promises
        receivers[message.type](message);
    }

    // message receiver handlers by message type
    var receivers = {
        "resolve": function (message) {
            if (locals.has(message.to)) {
                resolveLocal(message.to, decode(message.resolution));
            }
        },
        // a "send" message forwards messages from a remote
        // promise to a local promise.
        "send": function (message) {

            // forward the message to the local promise,
            // which will return a response promise
            var local = locals.get(message.to).promise;
            var response = Q.dispatch(local, message.op, decode(message.args));

            // connect the local response promise with the
            // remote response promise:

            // if the value is ever resolved, send the
            // fulfilled value across the wire
            Q.when(response, function (resolution) {
                try {
                    resolution = encode(resolution);
                } catch (exception) {
                    try {
                        resolution = {"!": encode(exception)};
                    } catch (exception) {
                        resolution = {"!": null};
                    }
                }
                var envelope = JSON.stringify({
                    "type": "resolve",
                    "to": message.from,
                    "resolution": resolution
                });
                connection.put(envelope);
            }, function (reason) {
                try {
                    reason = encode(reason);
                } catch (exception) {
                    try {
                        reason = encode(exception);
                    } catch (exception) {
                        reason = null;
                    }
                }
                envelope = JSON.stringify({
                    "type": "resolve",
                    "to": message.from,
                    "resolution": {"!": reason}
                })
                connection.put(envelope);
            })
            .done();

        }
    }

    // construct a local promise, such that it can
    // be resolved later by a remote message
    function makeLocal(id) {
        if (locals.has(id)) {
            return locals.get(id).promise;
        } else {
            var deferred = Q.defer();
            locals.set(id, deferred);
            return deferred.promise;
        }
    }

    // a utility for resolving the local promise
    // for a given identifier.
    function resolveLocal(id, value) {
        _debug('resolve:', "L" + JSON.stringify(id), JSON.stringify(value));
        locals.get(id).resolve(value);
    }

    // makes a promise that will send all of its events to a
    // remote object.
    function makeRemote(id) {
        return Q.makePromise({
            when: function () {
                return this;
            }
        }, function (op) {
            var localId = makeId();
            var response = makeLocal(localId);
            var args = Array.prototype.slice.call(arguments, 1);
            _debug('sending:', "R" + JSON.stringify(id), JSON.stringify(op), JSON.stringify(args));
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

    // serializes an object tree, encoding promises such
    // that JSON.stringify on the result will produce
    // "QSON": serialized promise objects.
    function encode(object) {
        if (Q.isPromise(object)) {
            var id = makeId();
            makeLocal(id);
            resolveLocal(id, object);
            return {"@": id};
        } else if (Array.isArray(object)) {
            return object.map(encode);
        } else if (typeof object === "object") {
            var result = {};
            for (var key in object) {
                if (has.call(object, key)) {
                    var newKey = key;
                    if (/^[!@]$/.exec(key))
                        newKey = key + key;
                    result[newKey] = encode(object[key]);
                }
            }
            return result;
        } else {
            return object;
        }
    }

    // decodes QSON
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
                    if (/^[!@]+$/.exec(key))
                        newKey = key.substring(1);
                    newObject[newKey] = decode(object[key]);
                }
            }
            return newObject;
        } else {
            return object;
        }
    }

    // a peer-to-peer promise connection is symmetric: both
    // the local and remote side have a "root" promise
    // object. On each side, the respective remote object is
    // returned, and the object passed as an argument to
    // Connection is used as the local object.  The identifier of
    // the root object is an empty-string by convention.
    // All other identifiers are numbers.
    makeLocal(rootId);
    resolveLocal(rootId, local);
    return makeRemote(rootId);

}

// Coerces a Worker to a Connection
// Idempotent: Passes Connections through unaltered
function adapt(port, origin) {
    var send;
    // Adapt the sender side
    // ---------------------
    if (port.postMessage) {
        // MessagePorts
        send = function (message) {
            // some message ports require an "origin"
            port.postMessage(message, origin);
        };
    } else if (port.send) {
        // WebSockets have a "send" method, indicating
        // that we cannot send until the connection has
        // opened.  We change the send method into a
        // promise for the send method, resolved after
        // the connection opens, rejected if it closes
        // before it opens.
        var deferred = Q.defer();
        send = deferred.promise;
        if (port.on) {
            deferred.resolve(port.send);
        } else if (port.addEventListener) {
            port.addEventListener("open", function () {
                deferred.resolve(port.send);
            });
            port.addEventListener("close", function () {
                queue.close();
                deferred.reject("Connection closed.");
            });
        }
    } else if (port.get && port.put) {
        return port;
    } else {
        throw new Error("An adaptable message port required");
    }

    // Adapt the receiver side
    // -----------------------
    // onmessage is one thing common between WebSocket and
    // WebWorker message ports.
    var queue = Queue();
    if (port.on) {
        port.on("message", function (data) {
            queue.put(data);
        }, false);
    } else if (port.addEventListener) {
        port.addEventListener("message", function (event) {
            queue.put(event.data);
        }, false);
    } else {
        port.onmessage = function (event) {
            queue.put(event.data);
        };
    }

    // Message ports have a start method; call it to make sure
    // that messages get sent.
    if (port.start) {
        port.start();
    }

    var close = function () {
        port.close && port.close();
        return queue.close();
    };

    return {
        "get": queue.get,
        "put": function (message) {
            return Q.invoke(send, "call", port, message);
        },
        "close": close,
        "closed": queue.closed
    };
}

