<!-- vim:ts=4:sts=4:sw=4:et:tw=60 -->

# 0.6.1

-   The reason a connection was closed is now communicated to all pending
    promises that are rejected because of a closed connection.  (@felixge)
    These errors now have a `cause` property, for the original `Error`.
-   Adds support for an `onmessagelost` option that will be invoked if a message
    is sent to a non-existant promise. This can occur if the promise is
    collected from the LRU. (@stuk)
-   Ensures that the service root object for a connection is never evicted from
    the LRU cache of local promises. (@stuk)
-   The `capacity` option takes over for the former `max` option, setting the
    capacity of the LRU for cached promises.

# 0.6.0

-   :warning: Only treat object literals, descending directly from Object
    prototype or Error prototype, as pass-by-copy objects. All others are pass
    by remote reference. This may cause minor compatibility problems.
    Note that in a future release, all object references will be
    pass-by-reference by default, and pass-by-copy only explicitly.
-   Support the marshalling of reference cycles.
-   Support Chrome extension message ports, with their
    `port.onMessage.addListener` interface.

# 0.5.6

-   Pending remote promises are rejected if the underlying connection
    closes

# 0.5.5

-   Support for bridging NaN, Infinity, -Infinity
    <cloud9@paulkoppen.com>
-   Support for bridging all properties of an Error (@thibaultzanini)

# 0.5.4

-   Bridge progress events
-   Update dependencies
-   Evaluating Testling for continuous integration

# 0.5.3

-   Bridge null and undefined properly

# 0.5.2

-   Bug fixes for remote function calls

# 0.5.1

-   Bug fixes for remote function calls

# 0.5.0 - BACKWARD INCOMPATIBLE

-   Updates for Q 0.9

# 0.4.7

-   Fixes the Queue module dependency

# 0.4.6

-   Fixes a dependency problem in the adapter module

# 0.4.5

-   Uses semantic versioning for dependency ranges
-   Factors the adapter into a separate module
-   Improves the bridge protocol such that it can transfer functions and
    error objects.

# 0.4.4

-   Renamed to Q-Connection, from Q-Comm
-   Fixes a missing variable scope

# 0.4.2

-   Updated dependencies
-   Fixed tests

# 0.4.1 - BACKWARD INCOMPATIBLE

-   Support for Node websocket, since abandoned
-   Abandon support for non-CommonJS script or module loading
-   Bug fix for improbable random number collisions
-   John Barton's work on UUID et cetra

# 0.4.0

Elided.

# 0.3.1

-   Added example of communicating with an iframe.
-   Added "origin" option to simplify communicating between
    window message ports.

# 0.3.0 - REBOOT

-   Q_COMM.Connection now accepts message ports and
    assimilates them.  There are no specialized adapters.
    That is left as an exercise for other libraries.

# 0.2.0 - BACKWARD INCOMPATIBLE*

-   Remote objects can now be directly connected using any
    W3C message port including web workers and web sockets.
-   *Brought message port adapter code into q-comm.js and
    moved all other communication layers out to separate
    packages (to be q-comm-socket.io and q-comm-node).
-   *Renamed `Peer` to `Connection`.

# 0.1.2

-   Added Mozilla Jetpack packaging support. (gozala)

# 0.1.1

-   Alterations to far references
-   Upgraded Q for duck-promises

# 0.1.0 - BACKWARD INCOMPATIBLE

-   Removed the socket.io-server "Server" constructor and
    renamed "SocketServer" to "Server".  Creating an
    object-to-object link and creating a connection are now
    explicitly separated in all usage.
-   Added the local object argument to the socket.io-client
    connection constructor.
-   Added a "swarm" example.

# 0.0.3

-   Upgraded dependency on `q` to v0.2.2 to fix bug in Queue
    implementation.

# 0.0.2

-   Added missing dependency on `n-util`.

# 0.0.1

-   Removed false dependency on `q-io`.

