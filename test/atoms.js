'use strict'

var utils = require('./utils');
var Q = require('q')

exports['test echo'] = function (assert, done) {
  var message = 'hello';
  var peers = utils.createPeers({
    echo: function (message) {
      return message;
    }
  });

  Q.when(Q.post(peers.remote, 'echo', message), function(value) {
    assert.equal(value, message, 'should echo back the message');
    done();
  }, function (reason) {
    assert.fail(reason);
    done();
  });
};

exports['test get atom'] = function (assert, done) {
  var peers = utils.createPeers({ foo: 'some value' });
  
  Q.when(Q.get(peers.remote, 'foo'), function(value) {
    assert.equal(value, peers.object.foo, 'value mathches actual value');
    done();
  }, function (reason) {
    assert.fail(reason);
    done();
  });
}

exports['test put atom'] = function (assert, done) {
  var peers = utils.createPeers({});

  Q.when(Q.put(peers.remote, 'foo', 'bar'), function(value) {
    assert.equal(peers.object.foo, 'bar', 'value of target has changed');
  });
  Q.when(Q.get(peers.remote, 'foo'), function(value) {
    assert.equal(value, peers.object.foo, 'received value mathes actual value');
    done();
  }, function(reason) {
    assert.fail(reason);
    done();
  });
}

exports['test del'] = function (assert, done) {
  var peers = utils.createPeers({ foo: 'bar' });

  Q.when(Q.del(peers.remote, 'foo'), function(value) {
    assert.ok(!('foo' in peers.object), 'property must be deleted');
    done();
  }, function(reason) {
    assert.fail(reason);
    done();
  });
}

if (module == require.main) require('test').run(exports)
