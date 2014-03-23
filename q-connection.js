/*global -WeakMap */
"use strict";

var Q = require("q");
var asap = require("asap");
var LruMap = require("collections/lru-map");
var WeakMap = require("collections/weak-map");

Connection.nextId = 0;

// http://erights.org/elib/distrib/captp/4tables.html

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

    // Positive identifiers indicate sent promises.
    // Negative identifiers indicate received promises.
    this.remotes = new LruMap(null, options.capacity);
    this.remotes.observeMapChange(this, "remotes");
    // Positive identifiers indicate sent objects.
    // Negative identifiers indicate received objects.
    this.objects = new LruMap(null, options.capacity);
    // maps local objects to encoded references
    // {@} indicates a shared promise
    // {$} indicates a shared object
    // {->} indicates a shared function
    this.references = new WeakMap();

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
        var args = this.decode(message.args);
        this.log("@" + (-message.to), "received dispatch", message.op, args, "->", "@" + (-message.from));
        var result = this.getRemote(-message.to)
            .promise
            .dispatch(message.op, args);
        this.getRemote(-message.from).resolve(result);
    } else if (message.type === "objects") {
        this.log("received", message.objects);
        this.receiveObjects(message.objects);
    } else if (message.type === "resolve") {
        this.log("@" + (-message.id), "received resolution", message.value);
        this.getRemote(-message.id).resolve(this.decode(message.value));
    } else if (message.type === "reject") {
        this.log("@" + (-message.id), "received rejection", message.error);
        this.getRemote(-message.id).reject(this.decode(message.error));
    } else if (message.type === "pass") {
        this.log("@" + (-message.id), "received pass by ref promise");
        var remote = this.getRemote(-message.id);
        remote.promise = remote.promise.pass();
    } else {
        this.log("received unrecognized message", JSON.stringify(message));
    }
};

Connection.prototype.dispatchMessage = function (message) {
    this.stream.yield(message);
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

Connection.prototype.sendObjects = function (value) {
    var references = {};
    var result = this.encode(references, value);
    // An all-too-clever way to dispatch a message only if there are any new
    // references to send:
    for (var name in references) {
        this.log("sent", name, references);
        this.dispatchMessage({
            type: "objects",
            objects: references
        });
        break;
    }
    return result;
};

Connection.prototype.encode = function (references, value) {
    var remote, reference, referenceName, name, id, questionId, objectId;
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
                if (value.toBePassed()) {
                    this.log("@" + id, "sent pass by resolution promise note");
                    this.dispatchMessage({
                        type: "pass",
                        id: id
                    });
                }
            } else if (!Q.isPortable(value) || typeof value === "function") {
                questionId = this.nextQuestionId;
                this.nextQuestionId += 2;
                objectId = this.nextExportId;
                this.nextExportId += 2;
                remote = new Remote(this, questionId, objectId);
                remote.resolve(Q(value));
                this.remotes.set(questionId, remote);
                this.objects.set(objectId, value);
                if (typeof value === "function") {
                    reference = {"->": questionId};
                } else {
                    reference = {"@": questionId};
                }
                this.references.set(value, reference);
                this.references.set(remote.promise, reference);
            } else {
                id = this.nextExportId;
                this.nextExportId += 2;
                this.objects.set(id, value);
                this.references.set(value, {"$": id});
                reference = Array.isArray(value) ? [] : {};
                for (name in value) {
                    if (Object.hasOwnProperty.call(value, name)) {
                        referenceName = name.replace(/[@!%\$\/\\\-]/, escape);
                        reference[referenceName] = this.encode(references, value[name]);
                    }
                }
                references[id] = reference;
            }
        }
        return this.references.get(value);
    } else {
        return value;
    }
};

Connection.prototype.receiveObjects = function (references) {
    var id, reference, referenceName, object, objectName;
    // First pass creates objects so that they can be linked cyclically
    for (id in references) {
        if (Object.prototype.hasOwnProperty.call(references, id)) {
            reference = references[id];
            object = Array.isArray(reference) ? [] : {};
            this.objects.set(-id, object);
        }
    }
    // Second pass populates the objects with values and cross references
    for (id in references) {
        if (Object.prototype.hasOwnProperty.call(references, id)) {
            reference = references[id];
            object = this.objects.get(-id);
            for (referenceName in reference) {
                if (Object.prototype.hasOwnProperty.call(reference, referenceName)) {
                    objectName = referenceName.replace(/\\([\\!@%\$\/\-])/, unescape);
                    object[objectName] = this.decode(reference[referenceName], id);
                }
            }
        }
    }
};

Connection.prototype.decode = function (value, id) {
    if (Object(value) !== value) {
        return value;
    } else if ("%" in value) {
        if (value["%"] === "undefined") {
            return;
        } else if (value["%"] === "infinity") {
            return Number.POSITIVE_INFINITY;
        } else if (value["%"] === "-infinity") {
            return Number.NEGATIVE_INFINITY;
        } else if (value["%"] === "nan") {
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
    } else if ("->" in value) {
        var remoteId = -value["->"];
        var proxy = proxyFunction(this.getRemote(remoteId).promise);
        this.references.set(proxy, {"->": remoteId});
        return proxy;
    } else {
        return this.objects.get(id);
    }
};

function proxyFunction(remote) {
    return function () {
        return remote.apply(this, arguments);
    };
}

Connection.prototype.handleRemotesMapChange = function (plus, minus, key, type) {
    if (type === "delete") {
        if (minus.messages) {
            this.log("revoked", minus.id);
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
    if (this.resolution) {
        return this.resolution.inspect();
    } else {
        return {
            state: "remote",
            id: this.id,
            connection: this.connection.token
        };
    }
};

Remote.prototype.resolve = function (value) {
    if (!this.messages) {
        return;
    }
    if (this.promise === value) {
        if (this.connection) {
            this.connection.log("@" + this.id, "resolved remotely");
        }
        this.isRemote = true;
    } else {
        value = Q(value);
        if (this.connection) {
            this.connection.log("@" + this.id, "became", value.inspect());
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
    this.resolution = promise;
    promise.then(function (value) {
        if (!self.connection) {
            return; // For testing purposes
        }
        var reference = self.connection.sendObjects(value);
        self.connection.dispatchMessage({
            type: "resolve",
            id: self.id,
            value: reference
        });
    }, function (error) {
        if (!self.connection) {
            return; // For testing purposes
        }
        var reference = self.connection.sendObjects(Q.push(error));
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
            args: this.connection.sendObjects(args)
        });
        if (resolve) {
            resolve(question.promise);
        }
        this.connection.log("@" + this.id, "sent dispatch", op, this.connection.sendObjects(args), "->", "@" + question.id);
    }
};

function escape($0) {
    return "\\" + $0;
}

function unescape($0, $1) {
    return $1;
}

