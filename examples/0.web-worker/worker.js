
importScripts(
    "../../node_modules/q/q.js",
    "../../uuid.js",
    "../../q-comm.js"
);

var remote = Q_COMM.Connection(this, {
    hi: function (message) {
        return message;
    }
});
Q.invoke(remote, "hi", "Hello, Parent!")
.end();

