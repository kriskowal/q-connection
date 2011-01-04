// this module can be loaded both as a CommonJS module and
// as a browser script.  If included as a script, it constructs
// a "/q-comm" global property with its API and requires
// "/q" and and "/uuid" to be provided before its execution
// by the epynomous scripts/modules.
(function (require, exports) {

var Q = require("q");
var UUID = require("uuid");

function debug(message) {
    //console.log(message)
}

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
exports.Queue = Queue;
function Queue() {
    var ends = Q.defer();
    var closed = Q.defer();
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
            return Q.when(result, null, function (reason) {
                closed.resolve();
                return Q.reject(reason);
            });
            return result;
        },
        "closed": closed.promise,
        "close": function (reason) {
            var end = {"head": Q.reject(reason)};
            end.tail = end;
            ends.resolve(end);
            return closed.promise;
        }
    };
}

/**
 * @param connection
 * @param object
 */
exports.Peer = Peer;
function Peer(connection, object) {
    var remotes = {};
    var locals = {};
    var resolvers = {};

    // message reciever loop
    Q.when(connection.get(), get);
    function get(message) {
        debug(message);
        Q.when(connection.get(), get);
        receive(message);
    }

    // message receiver
    function receive(message) {
        message = JSON.parse(message);
        if (!locals[message.to])
            throw new Error("No such local promise: " + JSON.stringify(message.to));
        receivers[message.type](message);
    }

    // message receiver handlers by message type
    var receivers = {
        // a "near" message resolves a local promise with
        // a deserialized object, which may include other
        // promises in its property tree
        "near": function (message) {
            resolvers[message.to](decode(message.resolution));
        },
        // a "far" message resolves a local promise with
        // a promise for a remote object that will never
        // be fully resolved. Such an object is a Q.def
        // on the opposite end
        "far": function (message) {
            resolvers[message.to](makeRemote(message.from, "far"));
        },
        // a "send" message forwards messages from a remote
        // promise to a local promise.
        "send": function (message) {

            // forward the message to the local promise, 
            // which will return a response promise
            var local = locals[message.to];
            var response = Q.send.apply(
                undefined,
                [local, message.op].concat(decode(message.args))
            );

            // connect the local response promise with the
            // remote response promise:

            // determine whether the response promise
            // resolves to a "ref" promise or a "def"
            // promise.  "ref" promises get resolved and can
            // be observed remotely with a "when" call, but
            // "def" promises only forward their messages.
            // "def" promises are distinguishable from other
            // promises because they respond to an "isDef"
            // message with a resolution instead of a
            // rejection.
            var isDef = Q.send(response, 'isDef');
            Q.when(isDef, function () {
                // if it is a def, it will respond, don't
                // set up a when listener on the other side,
                // just instruct the other peer to forward
                // messages to our local response promise.
                var localId = UUID.generate();
                makeLocal(localId);
                resolveLocal(localId, response);
                connection.put(JSON.stringify({
                    "type": "far",
                    "to": message.from,
                    "from": localId
                }));
            }, function () {
                // if the value is ever resolved, send the
                // fully resolved value across the wire
                Q.when(response, function (resolution) {
                    connection.put(JSON.stringify({
                        "type": "near",
                        "to": message.from,
                        "resolution": encode(resolution)
                    }));
                }, function (reason) {
                    // otherwise, transmit a rejection
                    connection.put(JSON.stringify({
                        "type": "near",
                        "to": message.from,
                        "resolution": {"!": encode(reason)}
                    }));
                });
            });

        }
    }

    // construct a local promise, such that it can
    // be resolved later by a remote message
    function makeLocal(id) {
        if (locals[id])
            return locals[id];
        var deferred = Q.defer();
        resolvers[id] = deferred.resolve;
        locals[id] = deferred.promise;
        return deferred.promise;
    }

    // a utility for resolving the local promise
    // for a given identifier.
    function resolveLocal(id, value) {
        resolvers[id](value);
    }

    // makes a promise that will send all of its events to a
    // remote object.  such promises come in two flavors:
    // near and far.  "near" promises can eventually be
    // resolved if the remote promise gets resolved to a
    // value that can be serialized.  "far" promises are
    // decorated with "Q.def" on the remote side, to
    // indicate that they have methods or encapsulated state
    // that cannot be serialized, so they will only send
    // messages, and to ensure an early error on this side,
    // they will respond to "when" messages with a
    // rejection.
    function makeRemote(id, resolvability) {
        return Q.Promise(
            resolvability === "far" ? farDescriptor : nearDescriptor,
            function (op, resolve) {
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
            }
        );
    }
    var farReason = "This remote object will not resolve locally.";
    var farDescriptor = {
        "when": function (rejected) {
            return rejected ? rejected(farReason) : Q.reject(farReason);
        }
    }
    var nearDescriptor = {};

    // serializes an object tree, encoding promises such
    // that JSON.stringify on the result will produce
    // "QSON": serialized promise objects.
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

    // decodes QSON
    function decode(object) {
        if (!object) {
            return object;
        } else if (object['!']) {
            return Q.reject(object['!']);
        } else if (object['@']) {
            return makeRemote(object['@'], "near");
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

    // a peer-to-peer promise connection is symmetric: both
    // the local and remote side have a "root" promise
    // object. On each side, the respective remote object is
    // returned, and the object passed as an argument to
    // Peer is used as the local object.  The identifier of
    // the root object is an empty-string by convention.
    // All other identifiers are UUIDs.
    makeLocal("");
    resolveLocal("", object);
    return makeRemote("", "near");

}

// boilerplate that permits this module to be used as a
// <script> in less-than-ideal situations.
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
