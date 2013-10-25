
var Q = require("q");
var LruMap = require("collections/lru-map");
var UUID = require("./lib/uuid");
var adapt = require("./adapt");

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

    // Some day, the following will merely be:
    //  connection.forEach(function (message) {
    //      receive(message);
    //  })
    //  .then(function () {
    //      var error = new Error("Connection closed");
    //      locals.forEach(function (local) {
    //          local.reject(error);
    //      });
    //  })
    //  .done()

    // message receiver loop
    connection.get().then(get);
    function get(message) {
        _debug("receive:", message);
        connection.get().then(get);
        receive(message);
    }

    if (connection.closed) {
        connection.closed.then(function () {
            var error = new Error("Can't resolve promise because Connection closed");
            locals.forEach(function (local) {
                local.reject(error);
            });
        });
    }

    // message receiver
    function receive(message) {
        message = JSON.parse(message);
        _debug("receive: parsed message", message);

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
                dispatchLocal(message.to, 'resolve', decode(message.resolution));
            }
        },
        "notify": function (message) {
            if (locals.has(message.to)) {
                dispatchLocal(message.to, 'notify', decode(message.resolution));
            }
        },
        // a "send" message forwards messages from a remote
        // promise to a local promise.
        "send": function (message) {

            // forward the message to the local promise,
            // which will return a response promise
            var local = locals.get(message.to).promise;
            var response = local.dispatch(message.op, decode(message.args));
            var envelope;

            // connect the local response promise with the
            // remote response promise:

            // if the value is ever resolved, send the
            // fulfilled value across the wire
            response.then(function (resolution) {
                try {
                    resolution = encode(resolution);
                } catch (exception) {
                    try {
                        resolution = {"!": encode(exception)};
                    } catch (exception) {
                        resolution = {"!": null};
                    }
                }
                envelope = JSON.stringify({
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
            }, function (progress) {
                try {
                    progress = encode(progress);
                    envelope = JSON.stringify({
                        "type": "notify",
                        "to": message.from,
                        "resolution": progress
                    });
                } catch (exception) {
                    try {
                        progress = {"!": encode(exception)};
                    } catch (exception) {
                        progress = {"!": null};
                    }
                    envelope = JSON.stringify({
                        "type": "resolve",
                        "to": message.from,
                        "resolution": progress
                    });
                }
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
    function dispatchLocal(id, op, value) {
        _debug(op + ':', "L" + JSON.stringify(id), JSON.stringify(value), typeof value);
        locals.get(id)[op](value);
    }

    // makes a promise that will send all of its events to a
    // remote object.
    function makeRemote(id) {
        return Q.makePromise({
            when: function () {
                return this;
            }
        }, function (op, args) {
            var localId = makeId();
            var response = makeLocal(localId);
             _debug('sending:', "R" + JSON.stringify(id), JSON.stringify(op), JSON.stringify(encode(args)));
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
        if (object === undefined) {
            return {"%": "undefined"};
        } else if (Object(object) !== object) {
            if (typeof object == "number") {
                if (object === Number.POSITIVE_INFINITY) {
                    return {"%": "+Infinity"};
                } else if (object === Number.NEGATIVE_INFINITY) {
                    return {"%": "-Infinity"};
                } else if (isNaN(object)) {
                    return {"%": "NaN"};
                }
            }
            return object;
        } else if (Q.isPromise(object) || typeof object === "function") {
            var id = makeId();
            makeLocal(id);
            dispatchLocal(id, 'resolve', object);
            return {"@": id, "type": typeof object};
        } else if (Array.isArray(object)) {
            return object.map(encode);
        } else if (typeof object === "object") {
            var result = {};
            if (object instanceof Error) {
                result.message = object.message;
                result.stack = object.stack;
            }
            for (var key in object) {
                if (has.call(object, key)) {
                    var newKey = key.replace(/[@!%\\]/, function ($0) {
                        return "\\" + $0;
                    });
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
        if (Object(object) !== object) {
            return object;
        } else if (object['%']) {
            if (object["%"] === "undefined") {
                return undefined;
            } else if (object["%"] === "+Infinity") {
                return Number.POSITIVE_INFINITY;
            } else if (object["%"] === "-Infinity") {
                return Number.NEGATIVE_INFINITY;
            } else if (object["%"] === "NaN") {
                return Number.NaN;
            } else {
                return Q.reject(new TypeError("Unrecognized type: " + object["%"]));
            }
        } else if (object['!']) {
            return Q.reject(object['!']);
        } else if (object['@']) {
            var remote = makeRemote(object["@"]);
            if (object.type === "function") {
                return function () {
                    return Q.fapply(remote, Array.prototype.slice.call(arguments));
                };
            } else {
                return remote;
            }
        } else if (Array.isArray(object)) {
            return object.map(decode);
        } else {
            var newObject = {};
            for (var key in object) {
                if (has.call(object, key)) {
                    var newKey = key.replace(/\\([\\!@%])/, function ($0, $1) {
                        return $1;
                    });
                    newObject[newKey] = decode(object[key]);
                }
            }
            return newObject;
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
    dispatchLocal(rootId, 'resolve', local);
    return makeRemote(rootId);

}

