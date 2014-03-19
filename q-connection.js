/*global -WeakMap */
"use strict";

var Q = require("q");
var asap = require("asap");
var LruMap = require("collections/lru-map");
var WeakMap = require("collections/weak-map");

Connection.nextId = 0;

// http://erights.org/elib/distrib/captp/4tables.html

// Questions: remote promise for an object from the far side of the connection.
// Questions have positive identifiers.
// The near side of a connection assigns question identifiers. They will be
// positive locally, and negative remotely.
// The far side of the connection should eventually send a message to answer
// the question.
// The answer may simply state that the remote reference has been resolved,
// in which case, the question continues to proxy messages to the far side.
// The answer may also be either an import, export, or another answer.
// Messages can be dispatched on an unresolved question. If the question is
// pending, the messages are forwarded to the far side of the connection.
// If the message is resolved, the messages are forwarded to the resolution
// promise locally.

// Answers: remote promise for a resolution on the near side of the connection,
// corresponding to a remote question.
// Answers have negative identifiers.

// Questions and answers are referenced with {"@": id} objects.

// Imports and Exports: If an object is marked for pass-by-copy using
// Q.passByCopy or Q.push, it will be given a positive identifier locally,
// serialized, and transmitted over the connection.
// The corresponding import on the far side of the connection will have the
// negative identifier.
// Once an object has been transmitted, it will be referred to in messages as
// {"$": id}, using the identifier from the sender's perspective.

module.exports = Connection;
function Connection(stream, local, options) {
    if (!(this instanceof Connection)) {
        return new Connection(stream, local, options);
    }

    var self = this;
    options = options || {};
    this.options = options;
    this.console = options.console;

    this.id = options.id || this.constructor.nextId++;
    this.nextQuestionId = 3;
    this.nextExportId = 2;
    this.token = {};
    this.stream = stream;

    // In a message, identifiers reflect the *sender's* view of the domain.
    // In memory, identifiers reflect our own view of the domain.

    // Remotes are encoded as {@} references.
    // Positive identifiers indicate questions.
    // Negative identifiers indicate answers.
    this.remotes = new LruMap(null, options.capacity);
    this.remotes.observeMapChange(this, "remotes");
    // Objects are encoded as {$} references.
    // Positive identifiers indicate exports.
    // Negative identifiers indicate imports.
    this.objects = new LruMap(null, options.capacity);
    // {@} or {$} object corresponding to another object
    this.references = new WeakMap();

    // CURSOR

    // consume incoming messages
    stream.forEach(this.handleMessage, this)
    .finally(function () {
        self.remotes.clear();
        self.objects.clear();
        stream.return();
    })
    .done();

    this.getRemote(1).resolve(local);
    return this.getRemote(-1).promise;
}

Connection.prototype.log = function () {
    if (this.console) {
        var args = Array.prototype.slice.call(arguments);
        args.unshift("" + this.id);
        this.console.log.apply(this.console, args);
    }
};

Connection.prototype.handleMessage = function (message) {
    if (message.type === "dispatch") {
        this.log("@" + (-message.to), "RECEIVED DISPATCH", message.op, message.args, "->", "@" + (-message.from));
        var result = this.getRemote(-message.to)
            .promise
            .dispatch(message.op, this.import(message.args));
        this.getRemote(-message.from).resolve(result);
    } else if (message.type === "send") {
        this.log("$" + (-message.id), "RECEIVED VALUE", message.value);
        this.import(message.value, -message.id);
    } else if (message.type === "resolve") {
        this.log("@" + (-message.id), "RECEIVED RESOLUTION", message.value);
        this.getRemote(-message.id).resolve(this.import(message.value));
    } else if (message.type === "reject") {
        this.log("@" + (-message.id), "RECEIVED REJECTION", message.error);
        this.getRemote(-message.id).reject(this.import(message.error));
    } else {
        this.log("RECEIVED UNRECOGNIZED MESSAGE", JSON.stringify(message));
    }
};

Connection.prototype.dispatchMessage = function (message) {
    if (this.options.Buffer) {
    } else if (this.options.Uint8Array) {
    } else {
        this.stream.yield(message);
    }
};

Connection.prototype.getRemote = function (id) {
    if (id === undefined) {
        id = this.nextQuestionId;
        this.nextQuestionId += 2;
    }
    var remote = this.remotes.get(id);
    if (!remote) {
        remote = new Remote(this, id);
        this.remotes.set(id, remote);
        this.references.set(remote.promise, {"@": id});
    }
    return remote;
};

var undefinedRepresentation = {"%": "undefined"};
var infinityRepresentation = {"%": "infinity"};
var minusInfinityRepresentation = {"%": "-infinity"};
var nanRepresentation = {"%": "nan"};

Connection.prototype.export = function (value) {
    if (value === undefined) {
        return undefinedRepresentation;
    } else if (typeof value === "number") {
        if (value === Number.POSITIVE_INFINITY) {
            return infinityRepresentation;
        } else if (value === Number.NEGATIVE_INFINITY) {
            return minusInfinityRepresentation;
        } else if (value !== value) {
            return nanRepresentation;
        } else {
            return value;
        }
    } else if (Object(value) === value) {
        var remote, reference, id;
        if (!this.references.has(value)) {
            if (Q.isPromise(value)) {
                id = this.nextQuestionId;
                this.nextQuestionId += 2;
                remote = new Remote(this, id);
                remote.resolve(value);
                this.remotes.set(id, remote);
                reference = {"@": id};
                this.references.set(value, reference);
                this.references.set(remote, reference);
            } else if (!Q.isPortable(value)) {
                var questionId = this.nextQuestionId;
                this.nextQuestionId += 2;
                var objectId = this.nextExportId;
                this.nextExportId += 2;
                remote = new Remote(this, questionId, objectId);
                remote.resolve(Q(value));
                this.remotes.set(questionId, remote);
                this.objects.set(objectId, value);
                reference = {"@": questionId};
                this.log("ENCODING", value, reference);
                this.references.set(value, reference);
                this.references.set(remote, reference);
            } else {
                id = this.nextExportId;
                this.nextExportId += 2;
                this.objects.set(id, value);
                this.references.set(value, {"$": id});
                var representation = Array.isArray(value) ? [] : {};
                for (var name in value) {
                    var representationName = name.replace(/[@!%\$\/\\]/, escape);
                    representation[representationName] = this.export(value[name]);
                }
                this.log("$" + id, "SENT", representation);
                this.dispatchMessage({
                    type: "send",
                    id: id,
                    value: representation
                });
            }
        }
        return this.references.get(value);
    } else {
        return value;
    }
};

Connection.prototype.import = function (value, id) {
    if (Object(value) !== value) {
        return value;
    } else if ("%" in value) {
        if (value["%"] === "undefined") {
            return;
        } else if (value["%"] === "+Infinity") {
            return Number.POSITIVE_INFINITY;
        } else if (value["%"] === "-Infinity") {
            return Number.NEGATIVE_INFINITY;
        } else if (value["%"] === "NaN") {
            return Number.NaN;
        }
    } else if ("@" in value) {
        var remote = this.getRemote(-value["@"]);
        if (remote.objectId !== void 0) {
            return this.objects.get(remote.objectId);
        } else {
            return remote.promise;
        }
    } else if ("$" in value) {
        return this.objects.get(-value.$);
    } else {
        var result = Array.isArray(value) ? [] : {};
        if (id !== void 0) {
            this.objects.set(id, result);
            this.references.set(result, {"$": id});
        }
        for (var name in value) {
            var resultName = name.replace(/\\([\\!@%\$\/])/, unescape);
            result[resultName] = this.import(value[name]);
        }
        return result;
    }
};

Connection.prototype.handleRemotesMapChange = function (plus, minus, key, type) {
    if (type === "delete") {
        if (minus.messages) {
            this.log("REVOKED", minus.id);
            minus.reject(this.revocationError);
        }
    }
};

Connection.prototype.revocationError = new Error("Can't resolve promise because connection closed");

Connection.prototype.Remote = Remote;
function Remote(connection, id, objectId) {
    this.connection = connection;
    this.id = id;
    this.objectId = objectId;
    this.promise = new Q.Promise(this);
    this.messages = [];
    this.value = null;
}

Remote.prototype.inspect = function () {
    return {
        state: "remote",
        id: this.id,
        connection: this.connection.token
    };
};

Remote.prototype.resolve = function (value) {
    if (!this.messages) {
        return;
    }
    if (this.promise === value) {
        if (this.connection) {
            this.connection.log("@" + this.id, "RESOLVED REMOTELY");
        }
        this.isRemote = true;
    } else {
        value = Q(value);
        if (this.connection) {
            this.connection.log("@" + this.id, "BECAME", value.inspect());
        }
        this.become(value);
    }
    this.flush();
};

Remote.prototype.reject = function (error) {
    if (!this.messages) {
        return;
    }
    this.become(Q.reject(error));
    this.flush();
};

Remote.prototype.become = function (promise) {
    var self = this;
    promise.then(function (value) {
        if (!self.connection) {
            return; // For testing purposes
        }
        var reference = self.connection.export(value);
        self.connection.dispatchMessage({
            type: "resolve",
            id: self.id,
            value: reference
        });
    }, function (error) {
        if (!self.connection) {
            return; // For testing purposes
        }
        var reference = self.connection.export(error);
        self.connection.dispatchMessage({
            type: "reject",
            id: self.id,
            error: reference
        });
    })
    .done();
    this.promise = promise;
};

Remote.prototype.flush = function () {
    var promise = this.promise;
    this.messages.forEach(function (message) {
        asap(function () {
            promise.rawDispatch(message[0], message[1], message[2]);
        });
    });
    this.messages = null;
};

Remote.prototype.dispatch = function (resolve, op, args) {
    if (op === "then") {
        if (this.messages) {
            this.messages.push([resolve, op, args]);
        } else if (this.isRemote) {
            resolve(this.promise);
        } else {
            this.promise.rawDispatch(resolve, op, args);
        }
    } else {
        // TODO consider also queuing the message so that we can shortcut a
        // round trip, race the server to the conclusion.
        var question = this.connection.getRemote();
        Q.push(args);
        args.forEach(Q.push);
        this.connection.dispatchMessage({
            type: "dispatch",
            to: this.id,
            from: question.id,
            op: op,
            args: this.connection.export(args)
        });
        resolve(question.promise);
        this.connection.log("@" + this.id, "SENT DISPATCH", op, this.connection.export(args), "->", "@" + question.id);
    }
};

function escape($0) {
    return "\\" + $0;
}

function unescape($0, $1) {
    return $1;
}

