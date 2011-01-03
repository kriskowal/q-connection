
var Q = require("q");
var Peer = require("q-comm/webworker").Peer;

var local = Q.def({
    "identity": function (x) {
        return x;
    }
});

var remote = Peer(this, local);

