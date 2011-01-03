(function () {
    var Q = window["/q"];
    var UUID = window["/uuid"];
    this.WEB_SOCKET_SWF_LOCATION = "/websocket.swf";
    var has = Object.prototype.hasOwnProperty;

    var remote = (function () {

        var locals = {};
        function serialize(object) {
            if (Q.isPromise(object)) {
                var id = UUID.generate();
                locals[id] = Q.defer();
                Q.when(object, locals[id].resolve);
                return {"@": id};
            } else if (Array.isArray(object)) {
                return object.map(serialize);
            } else if (typeof object === "object") {
                var result = {};
                for (var name in object) {
                    if (has.call(object, name)) {
                        result[name] = serialize(object[name]);
                    }
                }
                return result;
            } else {
                return object;
            }
        }
        function respond(id) {
            var response = Q.when(locals[id].promise, function (object) {
                return serialize(object);
            }, function (reason) {
                return {"!": reason};
            });
            Q.when(response, function (response) {
                response = JSON.stringify({
                    "method": "send",
                    "value": response,
                    "id": id
                });
                client.send(response);
            });
        }

        var remotes = {};
        function deserialize(object) {
            if (!object)
                return object;
            if (object['!'])
                return Q.reject(object['!']);
            if (object['@'])
                return request(object['@']);
            for (var key in object) {
                if (has.call(object, key)) {
                    var newKey = key;
                    /* TODO mirror in serialize
                    if (/^[!@]+$/.exec(key))
                        newKey = key.substring(1);
                    */
                    object[newKey] = deserialize(object[key]);
                }
            }
            return object;
        }
        function request(id) {
            if (!remotes[id]) {
                var deferred = remotes[id] = Q.defer();
                socket.send(JSON.stringify({
                    "method": "get",
                    "id": id
                }));
            }
            return remotes[id].promise;
        }

        function handleMessage(message) {
            message = JSON.parse(message);
            ({
                "get": function () {
                    var id = message.id;
                    respond(id);
                },
                "put": function () {
                    var id = message.id;
                },
                "send": function () {
                    remotes[message.id].resolve(deserialize(message.value));
                }
            }[message.method] || function () {
                console.error('message from client not recognized', request);
            })();
        }

        var socket = new io.Socket();
        socket.connect();
        socket.on('connect', function () {
            console.log('connected');
        });
        socket.on('message', function (message) {
            console.log("message", message);
            handleMessage(message);
        });
        socket.on('disconnect', function () {
            console.log('disconnected');
        });

        return request("");
    })();

    Q.when(remote, function (remote) {
        console.log('remote', remote);
    }, console.error.bind(console));
    Q.when(Q.get(remote, "a"), function (a) {
        console.log('remote.a', a);
    }, console.error.bind(console));
    Q.when(Q.put(remote, "b", 20), function () {
        console.log('remote.b=20 sent');
    }, console.error.bind(console));

})();

