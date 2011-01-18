'use strict'

var EventEmitter = require("events").EventEmitter;
var enqueue = require("event-queue").enqueue;
var comm = require("q-comm");
var Queue = require("q/queue").Queue;
var Q = require("q");


function defineSend(source, target) {
  source.send = function send(address, message) {
    enqueue(target.emit.bind(target, address, message))
  }
}

exports.Channel = function Channel() {
  var a = Object.create(EventEmitter.prototype);
  var b = Object.create(EventEmitter.prototype);
  defineSend(a, b);
  defineSend(b, a);
  return { a: a, b: b };
};

exports.Connection = function Connection(port, id) {
  var address = "channel#" + id;
  var queue = Queue();
  var closed = Q.defer();
  port.on(address, queue.put);
  return {
    get: queue.get,
    put: port.send.bind(port, address),
    close: closed.resolve,
    closed: closed.promise
  };
};

exports.Peer = function Peer(port, id, object) {
  return comm.Peer(exports.Connection(port, id), object);
};

exports.createPeers = function createPeers (object) {
  var address = (new Date()).getTime();
  var channel = exports.Channel();
  var local = Q.def(object);
  var remote = exports.Peer(channel.b, address);
  exports.Peer(channel.a, address, local);
  return {
    object: object,
    local: local,
    remote: remote
  };
}
