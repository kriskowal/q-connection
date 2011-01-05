
/**
 * Provides a peer-to-peer message-length-prefix
 * message passing protocol built on Node's net module.
 */

var Q = require("q");
var Queue = require("q/queue").Queue;
var COMM = require("q-comm");
var NET = require("net");
var Buffer = require("buffer").Buffer;
var UTIL = require("n-util");

function debug(message) {
    //console.log(message);
}

/**
 */
exports.listen = listen;
function listen(port, connect) {
    var listening = Q.defer();
    var server = NET.createServer(function (stream) {
        Q.when(Connection(stream), connect);
    });
    server.on('listening', function () {
        listening.resolve(server);
    });
    server.listen(port);
    return listening.promise;
}

/**
 */
exports.connect = connect;
function connect() {
    var stream = new NET.Stream();
    stream.connect.apply(stream, arguments);
    return Connection(stream);
}

var closeSentinel = -1;

/**
 */
exports.Connection = Connection;
function Connection(stream) {
    return Q.when(Stream(stream), function (stream) {
        var closed = Q.defer();
        var closing = false;
        var queue = Queue();
        Q.when(stream.closed, queue.close);
        Q.when(messageReadLoop(stream.read, queue.put), function () {
            Q.when(queue.closed, closed.resolve);
        });
        return {
            "get": queue.get,
            "put": function (message) {
                return messageWrite(stream, message);
            },
            "closed": closed.promise,
            "close": function () {
                stream.write(numberToBuffer(closeSentinel));
                stream.close();
            }
        };
    });
}

function messageReadLoop(read, callback) {
    return Q.when(read(4), function (header) {
        var length = bufferToNumber(header);
        if (length === closeSentinel)
            return;
        return Q.when(read(length), function (message) {
            callback(message.toString("utf-8"));
            return messageReadLoop(read, callback);
        });
    });
}

function messageWrite(stream, message) {
    if (typeof message !== "string")
        throw new Error("Messages must be strings.");
    message = new Buffer(message, "utf-8");
    stream.write(numberToBuffer(message.length));
    return stream.write(message);
}

function Stream(stream) {
    var buffers = [], accumulated = 0;
    var doneReading, goal = Infinity, achieved = Q.defer();
    var opened = Q.defer();
    var closed = Q.defer();
    var drained = Q.defer();
    var ended;

    function read(length) {
        var read = Q.defer();
        // synchronize reads
        doneReading = Q.when(doneReading, function () {
            // establish a completion condition and promise
            goal = length;
            achieved = Q.defer();
            checkRead();
            // the data emitter will resolve the achievement promise
            // when the requested length is available, or the 
            return Q.when(achieved.promise, function () {
                consolidate(buffers);
                var buffer = buffers.shift();
                length = Math.min(buffer.length, length);
                var newBuffer = buffer.slice(length, buffer.length);
                buffers.unshift(newBuffer);
                accumulated = newBuffer.length;
                read.resolve(buffer.slice(0, length));
                checkClose();
            });
        }, function (reason) {
            // doneReading gets rejected if the connection closes
            // prematurely, which is to say that the goal has not been
            // achieved when the connection closes.  if that's the
            // case, the current read must fail, and all subsequent
            // reads should continue to fail.
            read.reject(Q.reject(reason));
            return Q.reject(reason);
        });
        return read.promise;
    }

    // checks whether a message has been completed.
    function checkRead() {
        if (accumulated >= goal)
            achieved.resolve();
    }

    function checkClose() {
        if (ended && !accumulated)
            closed.resolve('Connection closed gracefully');
    }

    function write(data) {
        //if (!stream.writeable)
        //    return Q.reject("Stream not writeable");
        if (!stream.writable)
            return Q.reject("Stream is not writable");
        if (!data.length) // stream.write can't handle an empty buffer
            return drained;
        if (!stream.write(data))
            return drained;
    }

    function close() {
        if (goal === null) {
            achieved.resolve();
        } else {
            achieved.reject("Connection closed prematurely");
        }
        // TODO preemptively reject further reads
        stream.end();
        // report that the stream is closed when all
        // messages have been read
        // TODO
    }

    stream.on("connect", function () {
        opened.resolve({
            "read": read,
            "write": write,
            "closed": closed.promise,
            "close": close
        });
    });
    stream.on("error", function (error) {
        console.error(error.stack || error); // XXX
        achieved.reject(error);
    });
    stream.on("data", function (data) {
        debug("data " + data.inspect());
        buffers.push(data);
        accumulated += data.length;
        checkRead();
    });
    stream.on("drain", function () {
        debug("drained");
        if (Q.isResolved(closed.promise))
            return;
        drained.resolve();
        drained = Q.defer();
    });
    stream.on("end", function () {
        debug("closed");
        ended = true;
        checkClose();
    });

    return opened.promise;

}

function consolidate(buffers) {
    var length = 0;
    var at;
    var i;
    var ii = buffers.length;
    var buffer;
    var result;
    for (i = 0; i < ii; i++) {
        buffer = buffers[i];
        length += buffer.length;
    }
    result = new Buffer(length);
    at = 0;
    for (i = 0; i < ii; i++) {
        buffer = buffers[i];
        buffer.copy(result, at, 0);
        at += buffer.length;
    }
    buffers.splice(0, ii, result);
}

function bufferToNumber(buffer) {
    return (
        (buffer[0] << 24) +
        (buffer[1] << 16) +
        (buffer[2] <<  8) +
        (buffer[3]      )
    );
}

function numberToBuffer(number) {
    return new Buffer([
               number >> 24,
        0xFF & number >> 16,
        0xFF & number >> 8,
        0xFF & number
    ]);
}

// demo
function main() {
    Q.when(listen(2323, function (connection) {
        // server-side
        connection.put("Hello, World!");
        connection.put("");
        connection.close();
    }), function (server) {
        // client-side
        Q.when(connect(2323, ""), function (connection) {
            function readLoop() {
                return Q.when(connection.get(), function (message) {
                    console.log(message);
                    return readLoop();
                }, function (reason) {
                    debug(reason);
                    connection.close();
                    server.close();
                });
            }
            readLoop();
        }, Q.error);
    });
}

if (module === require.main)
    main();

