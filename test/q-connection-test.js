
var Q = require("q");
var asap = require("asap");
Q.longStackSupport = true;
Q.isIntrospective = true;
Error.stackTraceLimit = Infinity;
var Connection = require("../q-connection");
var Queue = require("q/queue");
var BufferStream = require("q-io/buffer-stream");

function makeStreams(latency) {
    var sending = new Queue();
    var receiving = new Queue();
    return {
        l2r: new BufferStream({get: sending.get, put: receiving.put}),
        r2l: new BufferStream({get: receiving.get, put: sending.put})
    };
}

function makePeers(remote, local, options) {
    var streams = makeStreams();
    return {
        remote: Connection(streams.l2r, local, options),
        local: Connection(streams.r2l, remote, options)
    };
}

describe("Remote", function () {
    var Remote = Connection.prototype.Remote;

    it("resolves to a local value immediately", function () {
        var remote = new Remote(null, 0);
        remote.resolve(10);
        return remote.promise.then(function (value) {
            expect(value).toBe(10);
        });
    });

    it("resolves to a local value in a future event", function () {
        var remote = new Remote(null, 0);
        asap(function () {
            remote.resolve(10);
        });
        return remote.promise.then(function (value) {
            expect(value).toBe(10);
        });
    });

    it("resolves to a remote value immediately", function () {
        var remote = new Remote(null, 0);
        remote.resolve(remote.promise);
        return remote.promise.then(function (value) {
            expect(value).toBe(remote.promise);
        });
    });

    it("resolves to a remote value in a future event", function () {
        var remote = new Remote(null, 0);
        asap(function () {
            remote.resolve(remote.promise);
        });
        return remote.promise.then(function (value) {
            expect(value).toBe(remote.promise);
        });
    });

});

describe("Connection", function () {

    it("should export a value", function () {
        var streams = makeStreams();
        var connection = Object.create(Connection);
        var remote = Connection.call(connection, streams.l2r, 10);
        streams.r2l.return();
        return streams.r2l.all().then(function (messages) {
            expect(messages).toEqual([
                {type: "resolve", id: 1, value: 10},
            ]);
        })
        .timeout(1000);
    });

    it("should resolve a remote promise", function () {
        var streams = makeStreams();
        var connection = Object.create(Connection);
        var remote = Connection.call(connection, streams.l2r, {});
        streams.r2l.return();
        return streams.r2l.all().then(function (messages) {
            expect(messages).toEqual([
                {type: "resolve", id: 1, value: {"@": 3}},
                {type: "resolve", id: 3, value: {"@": 3}}
            ]);
        })
        .timeout(1000);
    });

    it("should export a cyclic array", function () {
        var streams = makeStreams();
        var connection = Object.create(Connection.prototype);
        var a = []; a[0] = a;
        var remote = Connection.call(connection, streams.l2r, Q.push(a));
        streams.r2l.return();
        return streams.r2l.all().then(function (messages) {
            expect(messages).toEqual([
                {type: "objects", objects: {
                    2: [{"$": 2}]
                }},
                {type: "resolve", id: 1, value: {"$": 2}}
            ]);
        })
        .timeout(1000);
    });

});

describe("promises for remote objects", function () {

    it("obtains a promise for a remote value", function () {
        var peers = makePeers(20, 10);
        return Q.all([
            peers.remote.then(function (value) {
                expect(value).toBe(20);
            }),
            peers.local.then(function (value) {
                expect(value).toBe(10);
            })
        ]).thenResolve();
    });

    it("obtains a promise for a remote object", function () {
        var peers = makePeers({remote: 20}, {local: 10});
        return peers.remote.then(function (value) {
            expect(Q.isPromise(value)).toBe(true);
        });
    });

    it("obtains a proxy for a remote function", function () {
        var peers = makePeers(function () {
            return 10;
        });
        return peers.remote.then(function (remote) {
            expect(typeof remote).toBe("function");
            return remote().then(function (value) {
                expect(value).toBe(10);
            });
        });
    });

    it("pushes a local object", function () {
        var peers = makePeers(Q.push({a: 10}));
        return peers.remote.then(function (value) {
            expect(value).toEqual({a: 10});
        });
    });

    it("obtains a remote value", function () {
        var peers = makePeers({a: 10});
        return peers.remote.get("a").then(function (value) {
            expect(value).toBe(10);
        });
    });

    it("pulls a remote object", function () {
        var peers = makePeers({a: 10});
        return peers.remote.pull().then(function (value) {
            expect(value).toEqual({a: 10});
        });
    });

    it("revokes outstanding promises", function () {
        var streams = makeStreams();
        var remote = new Connection(streams.l2r);
        asap(function () {
            streams.r2l.return();
        });
        return remote.then(function () {
            expect(true).toBe(false);
        }, function (error) {
            expect(error.message).toBe("Can't resolve promise because connection closed");
        })
        .timeout(200);
    });

    it("invokes a remote method with a promise for the remote object", function () {
        var peers = makePeers({
            back: function (that) {
                var self = this;
                expect(Q.isPromise(that)).toBe(true);
                return that.then(function (that) {
                    expect(that).toBe(self);
                    return that === self;
                });
            }
        });
        return peers.remote.invoke("back", peers.remote)
        .then(function (equal) {
            expect(equal).toBe(true);
        })
    });

    it("invokes a remote method with a proxy for the remote object", function () {
        var peers = makePeers({
            back: function (that) {
                expect(that).toBe(this);
                return that === this;
            }
        });
        return peers.remote.then(function (remote) {
            expect(Q.isPromise(remote)).toBe(true);
            return remote.invoke("back", remote)
            .then(function (equal) {
                expect(equal).toBe(true);
            })
        });
    });

    it("invokes a remote method with a promise for an eventually remote object", function () {
        var peers = makePeers({
            foo: {},
            bar: function (foo) {
                var self = this;
                expect(Q.isPromise(foo)).toBe(true);
                return foo.then(function (foo) {
                    expect(foo).toBe(self.foo);
                });
            }
        });
        return peers.remote.invoke("bar", peers.remote.get("foo"));
    });

    it("passes a promise for an eventually remote object as a value to a remote method", function () {
        var peers = makePeers({
            foo: {},
            bar: function (foo) {
                var self = this;
                expect(Q.isPromise(foo)).toBe(false);
                expect(foo).toBe(self.foo);
            }
        });
        return peers.remote.invoke("bar", peers.remote.get("foo").pass());
    });

    it("passes messages that augment an object graph", function () {
        var graph = Q.push({a: 10, b: 20});
        graph.c = graph;
        var superGraph = {graph: graph};
        var peers = makePeers(superGraph);
        return peers.remote.get("graph").then(function (obtained) {
            expect(obtained).toEqual(graph);
            expect(obtained).not.toBe(graph);
            return peers.remote.pull().then(function (subObtained) {
                expect(subObtained.graph).toBe(obtained);
                expect(subObtained).toEqual(superGraph);
                expect(subObtained).not.toBe(superGraph);
            });
        });
    });

});

// Can send messages to a remote value before its resolution arrives.
// Can send messages to a remote value after its local resolution arrives.
// Replays still-pending messages on a local resolution, racing the results
// from the server.
// If messages arrive on a remote object after its resolution has been sent
// back to the local object, forward those messages back to the sender.

describe("serialization", function () {

    it("should serialize null", function () {
        var peers = makePeers({
            respond: function (value) {
                return value === null;
            }
        });
        return peers.remote.invoke("respond", null)
        .then(function (result) {
            expect(result).toBe(true);
        })
    });

    it("should serialize undefined", function () {
        var peers = makePeers({
            respond: function (value) {
                return value === undefined;
            }
        });
        return peers.remote.invoke("respond", undefined)
        .then(function (result) {
            expect(result).toBe(true);
        })
    });

    it("should serialize NaN", function () {
        var peers = makePeers({
            respond: function (value) {
                return value !== value; // NaN is the only value that breaks identity.
            }
        });
        return peers.remote.invoke("respond", NaN)
        .then(function (result) {
            expect(result).toBe(true);
        })
    });

    it("should serialize Infinity", function () {
        var peers = makePeers({
            respond: function (value) {
                return value === Number.POSITIVE_INFINITY;
            }
        });
        return peers.remote.invoke("respond", 1/0)
        .then(function (result) {
            expect(result).toBe(true);
        })
    });

    it("should serialize -Infinity", function () {
        var peers = makePeers({
            respond: function (value) {
                return value === Number.NEGATIVE_INFINITY;
            }
        });
        return peers.remote.invoke("respond", -1/0)
        .then(function (result) {
            expect(result).toBe(true);
        })
    });

    it("should serialize special key names", function () {
        var reference = {
            "@": 1,
            "@@": 2,
            "!": 3,
            "!!": 4,
            "%": 5,
            "%%": 6,
            "->": 7,
            "\\@": 8,
            "\\": 9
        };
        var peers = makePeers({
            respond: function (value) {
                return reference;
            }
        });
        return peers.remote.invoke("respond").pull()
        .then(function (response) {
            expect(response).toEqual(reference);
        });
    });

    it("should serialize simple reference cycles", function () {
        var peers = makePeers({
            respond: function () {
                var a = [];
                a[0] = a;
                return Q.push(a);
            }
        })
        return peers.remote.invoke("respond")
        .then(function (response) {
            expect(response[0]).toBe(response);
        });
    });

    it("should serialize complex reference cycles", function () {
        var peers = makePeers({
            respond: function () {
                var a = Q.push({});
                a.b = Q.push([a, a, a, 10, 20]);
                return Q.push({d: a});
            }
        })
        return peers.remote.invoke("respond")
        .then(function (response) {
            expect(response.d.b[1]).toBe(response.d);
        });
    });

});

xdescribe("pull", function () {
});

xdescribe("push", function () {
});

xdescribe("pass", function () {
});

xdescribe("get", function () {

    it("gets a value", function () {
    });

    it("gets a reference to a remote object", function () {
    });

});

xdescribe("call", function () {
});

xdescribe("invoke", function () {
});

xdescribe("iterate", function () {
});

xdescribe("keys", function () {
});

