// this module can be loaded both as a CommonJS module and
// as a browser script.  If included as a script, it constructs
// a "/q-comm" global property with its API and requires
// "/q" and and "/uuid" to be provided before its execution
// by the epynomous scripts/modules.
(function (require, exports) {

var Q = require("q");
var UUID = require("uuid");

function debug() {
    console.log.apply(console, arguments);
}

var rootId = "";

var has = Object.prototype.hasOwnProperty;

/**
 * @param connection
 * @param local
 */
exports.Peer = Peer;
function Peer(connection, local, max) {
    max = max || Infinity;
    var locals = Lru(max);

    var debugKey = Math.floor(Math.random() * 256).toString(16);
    function _debug() {
        debug.apply(null, [debugKey].concat(Array.prototype.slice.call(arguments)));
    }

    // message reciever loop
    Q.when(connection.get(), get);
    function get(message) {
        Q.when(connection.get(), get);
        receive(message);
    }

    // message receiver
    function receive(message) {
        message = JSON.parse(message);
        _debug(message);
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
                connection.put(JSON.stringify({
                    "type": "resolve",
                    "to": message.from,
                    "resolution": encode(response)
                }));
            }, function () {
                // if the value is ever resolved, send the
                // fully resolved value across the wire
                Q.when(response, function (resolution) {
                    connection.put(JSON.stringify({
                        "type": "resolve",
                        "to": message.from,
                        "resolution": encode(resolution)
                    }));
                }, function (reason) {
                    // otherwise, transmit a rejection
                    connection.put(JSON.stringify({
                        "type": "resolve",
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
        if (locals.has(id)) {
            return locals.get(id).promise;
        } else {
            var deferred = Q.defer();
            locals.set(id, deferred);
            //_debug(locals.keys());
            return deferred.promise;
        }
    }

    // a utility for resolving the local promise
    // for a given identifier.
    function resolveLocal(id, value) {
        _debug('resolve local', id, value);
        locals.get(id).resolve(value);
    }

    // makes a promise that will send all of its events to a
    // remote object.
    function makeRemote(id) {
        return Q.Promise({
        }, function (op, resolved, rejected) {
            var localId = UUID.generate();
            var response = makeLocal(localId);
            var args = Array.prototype.slice.call(arguments, 2);
            _debug('sending ' + op);
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

    // a peer-to-peer promise connection is symmetric: both
    // the local and remote side have a "root" promise
    // object. On each side, the respective remote object is
    // returned, and the object passed as an argument to
    // Peer is used as the local object.  The identifier of
    // the root object is an empty-string by convention.
    // All other identifiers are UUIDs.
    makeLocal(rootId);
    resolveLocal(rootId, local);
    return makeRemote(rootId);

}

var hasOwn = Object.prototype.hasOwnProperty;
function Lru(maxLength) {
    if (!maxLength)
        throw new Error("LRU cache must be constructed with a maximum length.");
    var map = {};
    var length = 0;

    var head = {};
    head.next = head;
    head.prev = head;
    function remove(node) {
        delete map[node.key];
        node.prev.next = node.next;
        node.next.prev = node.prev;
        length--;
    }
    function insert(node) {
        map[node.key] = node;
        var prev = head.prev;
        head.prev = node;
        node.prev = prev;
        prev.next = node;
        node.next = head;
        length++;
        if (length > maxLength)
            remove(head.next);
    }

    function get(key) {
        if (!hasOwn.call(map, key))
            throw new ValueError("LRU cache does not contain that key.");
        var node = map[key];
        remove(node);
        insert(node);
        return node.value;
    }
    function set(key, value) {
        var node;
        if (map[key]) {
            node = map[key];
            node.value = value;
            remove(node);
        } else {
            node = {};
            node.key = key;
            node.value = value;
        }
        insert(node);
    }
    function del(key) {
        var node = map[key];
        remove(node);
    }
    function has(key) {
        return hasOwn.call(map, key);
    }
    function keys() {
        return Object.keys(map);
    }

    function toSource() {
        return '[LRU ' + length + ' ' +
            Object.keys(map).map(function (key) {
                var node = map[key];
                return (
                    (node.prev.key || '@') +
                    '<-' + key + ':' + node.value + '->' +
                    (node.next.key || '@')
                );
            }).join(' ') + ']';
    }

    return {
        "get": get,
        "set": set,
        "del": del,
        "has": has,
        "toSource": toSource,
        "toString": toString,
        "keys": keys
    }
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
