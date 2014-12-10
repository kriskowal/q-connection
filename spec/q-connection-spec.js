/*global describe,it,expect */
require("./lib/jasmine-promise");
var Q = require("q");
var Queue = require("q/queue");
var Connection = require("../q-connection");

function makeChannel() {
    var sending = Queue();
    var receiving = Queue();
    return {
        l2r: {
            get: sending.get,
            put: receiving.put,
            close: sending.close,
            closed: sending.closed
        },
        r2l: {
            get: receiving.get,
            put: sending.put,
            close: receiving.close,
            closed: receiving.closed
        },
        close: function () {
            sending.close();
            receiving.close();
        }
    };
}

function makePeers(local, remote) {
    var channel = makeChannel();
    return {
        local: Connection(channel.l2r, local),
        remote: Connection(channel.r2l, remote),
        close: channel.close
    }
}

describe("channel", function () {
    it("should send messages", function () {
        var channel = makeChannel();
        channel.l2r.put(10);
        channel.r2l.put(20);
        var a = channel.l2r.get().then(function (value) {
            expect(value).toBe(20);
        });
        var b = channel.r2l.get().then(function (value) {
            expect(value).toBe(10);
        });
        return Q.all([a, b]);
    })
});

describe("onmessagelost", function () {
    it("should be called when a message is lost", function () {
        var done = Q.defer();

        var channel = makeChannel();
        var a = Connection(channel.l2r);
        var b = Connection(channel.r2l, {
            one: function () {},
            two: function () {}
        }, {
            max: 1,
            onmessagelost: function (message) {
                expect(message).toBeDefined();
                done.resolve();
            }
        });

        return Q.all([
            a.get("one"),
            a.get("two")
        ])
        .spread(function (one, two) {
            // Don't wait for the promises, because one of them will never
            // get resolved
            one();
            two();

            // All okay when onmessagelost is called. Otherwise we timeout
            return done.promise.timeout(50);
        });
    });
});

describe("root object", function () {
    it("is never forgotten", function () {
        var channel = makeChannel();
        var a = Connection(channel.l2r);
        var b = Connection(channel.r2l, {
            one: function () {},
            two: "pass"
        }, {
            max: 1
        });

        return a.get("one")
        .then(function () {
            return a.get("two").timeout(50);
        })
        .then(function (two) {
            expect(two).toEqual("pass");
        });
    });
});

describe("get", function () {
    it("should get the value of a remote property", function () {
        var peers = makePeers({
            a: 10
        });
        return peers.remote.get("a")
        .then(function (a) {
            expect(a).toBe(10);
        });
    });
});

describe("set", function () {
    it("should set the value for a remote property", function () {
        var local = {a: 10};
        var peers = makePeers(local);
        return peers.remote.set("a", 20)
        .then(function (result) {
            expect(result).toBe(undefined);
            expect(local.a).toBe(20);
        });
    });
});

describe("delete", function () {
    it("should delete a remote property", function () {
        var local = {a: 10};
        var peers = makePeers(local);
        return peers.remote.delete("a")
        .then(function (result) {
            expect(result).toBe(undefined);
            expect(local.a).toBe(undefined);
        });
    });
});

describe("keys", function () {
    it("should get the keys of a remote object", function () {
        var peers = makePeers({
            a: 10,
            b: 20
        });
        return peers.remote.keys()
        .then(function (keys) {
            expect(keys).toEqual(["a", "b"]);
        });
    });
});

describe("invoke", function () {
    it("should invoke a remote method", function () {
        var local = {
            add: function (a, b) {
                return a + b;
            }
        };
        var peers = makePeers(local);
        return peers.remote.invoke("add", 2, 3)
        .then(function (sum) {
            expect(sum).toBe(5);
        });
    });
});

describe("post", function () {
    it("should invoke a remote method", function () {
        var local = {
            add: function (a, b) {
                return a + b;
            }
        };
        var peers = makePeers(local);
        return peers.remote.post("add", [2, 3])
        .then(function (sum) {
            expect(sum).toBe(5);
        });
    });
});

describe("fcall", function () {
    it("should call a remote function", function () {
        var add = function (a, b) {
            return a + b;
        }
        var peers = makePeers(add);
        return peers.remote.fcall(2, 3)
        .then(function (sum) {
            expect(sum).toBe(5);
        });
    });
});

describe("fapply", function () {
    it("should call a remote function", function () {
        var add = function (a, b) {
            return a + b;
        }
        var peers = makePeers(add);
        return peers.remote.fapply([2, 3])
        .then(function (sum) {
            expect(sum).toBe(5);
        });
    });
});

describe("bidirectional communication", function () {
    it("should pass local promises to the remote", function () {
        var local = {
            bar: function (a, b) {
                expect(a).toBe("a");
                expect(b).toBe("b");
                return 10;
            }
        };
        var remote = {
            foo: function (local) {
                expect(Q.isPromise(local)).toBe(true);
                return local.invoke("bar", "a", "b");
            }
        };
        var peers = makePeers(remote, local);
        return peers.remote.invoke("foo", peers.local)
        .then(function (value) {
            expect(value).toBe(10);
        });
    });
});

describe("remote promises that fulfill to functions", function () {
    it("should become local functions", function () {
        var peers = makePeers({
            respond: function (callback) {
                return callback("World");
            }
        });
        return peers.remote.invoke('respond', function (who) {
            return "Hello, " + who + "!";
        })
        .then(function (message) {
            expect(message).toBe("Hello, World!");
        })
    });
});

describe("remote promises that notify progress", function () {
    it("should trigger local progress handler", function () {
        var peers = makePeers({
            resolveAfterNotify: function (times) {
                var deferred = Q.defer();
                var count = 0;
                setTimeout(function () {
                    while (count++ < times) {
                        deferred.notify('Notify' + count + ' time');
                    }
                    deferred.resolve('Resolving');
                }, 0);
                return deferred.promise;
            }
        });

        var notifyCount = 0;
        return peers.remote.invoke('resolveAfterNotify', 3).progress(function(p) {
            notifyCount++;
        }).then(function (message) {
            expect(notifyCount).toBe(3);
        });
    });
});

describe("rejection", function () {
    function expectRejected(promise) {
        return promise.then(function () {
            expect(true).toBe(false); // should not get here
        }, function (error) {
            expect(error.message).toMatch(/Connection closed because: .+/);
        })
        .timeout(500);
    }

    it("should become local functions", function () {
        var peers = makePeers({
            respond: function () {
                throw new Error("No!");
            }
        });
        return peers.remote.invoke("respond")
        .then(function () {
            expect(true).toBe(false); // should not get here
        })
        .catch(function (error) {
            expect(error.message).toBe("No!");
        })
    });

    it("should reject all pending promises on lost connection", function () {
        var peers = makePeers({
            respond: function () {
                return Q.defer().promise;
            }
        });
        peers.close();
        return expectRejected(peers.remote.invoke("respond"));
    });

    it("should reject all pending promises on lost connection 2", function () {
        var peers = makePeers({ a: 1 }, { b: 2 });
        peers.close();
        return Q.all([
            expectRejected(peers.local.get("b")),
            expectRejected(peers.remote.get("a"))
        ]);
    });

});

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
            "\\@": 7,
            "\\": 8
        };
        var peers = makePeers({
            respond: function (value) {
                return reference;
            }
        });
        return peers.remote.invoke("respond")
        .then(function (response) {
            expect(response).toEqual(reference);
        });
    });

    it("should serialize reference cycles", function () {
        var peers = makePeers({
            respond: function () {
                var a = [];
                a[0] = a;
                return a;
            }
        });
        return peers.remote.invoke("respond")
        .then(function (response) {
            expect(response[0]).toBe(response);
        });
    });

    it("should serialize complex reference cycles", function () {
        var peers = makePeers({
            respond: function () {
                var a = {};
                a.b = [a, a, a, 10, 20];
                return {d: a};
            }
        });
        return peers.remote.invoke("respond")
        .then(function (response) {
            expect(response.d.b[1]).toBe(response.d);
        });
    });

});

