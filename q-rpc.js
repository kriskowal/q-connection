// Google BSD license http://code.google.com/google_bsd_license.html
// Copyright 2011 Google Inc. johnjbarton@google.com

/*globals define exports require window Q_COMM*/

(function (definition) {
    var global = this;

    // RequireJS
    if (typeof define === "function") {
        define(["q-comm/q-comm"], function (Q_COMM) {
            var exports = {};
            var imports = {"Q_COMM": Q_COMM};
            definition(
                function (id) {
                    return imports[id];
                },
                exports
            );
            return exports;
        });

    // CommonJS
    } else if (typeof exports === "object") {
        definition(require, exports);

    // <script>
    } else {
        var imports = {"Q_COMM": Q_COMM};
        definition(
            function (id) {
                return imports[id];
            },
            Q_RPC = {}
        );
        console.log("Q_RPC", Q_RPC);
    }

})(function (require, exports) {

  // A left paren ( followed by any not-right paren ) followed by right paren
  var reParamList = /\(([^\)]*)\)/; 
  var reParameters = /\(([^\)]*)\)/;


function buildPromisingCalls(name, iface, remote) {
  var stub = {};
  Object.keys(iface).forEach(function(method) {
    // functions on stub operate on remote
    stub[method] =  function() {
      var args = Array.prototype.slice.call(arguments);       
      return remote.invoke.apply(remote, [name+'.'+method].concat(args));
    };
  });
  stub.Q_COMM_CONNECTION = remote;
  return stub;
}

// handlerSpec: empty function with correct arguments.
// return: an array of parameter names

function getParameters(handlerSpec) {
  var m = reParameters.exec(handlerSpec.toString());
  var params = m[1].split(',');
  var parameters = [];
  for (var i = 0; i < params.length; i++) {
    var param = params[i].trim();
    if (param) {
      parameters[i] = param;
    }
  }
  return parameters;
}
  

// otherWindow: eg an iframe or window.parent
// commands: object with function properties, call to otherWindow
// eventInterface: object with function properties, calls from otherWindow
// return: object with remote method calls

function makeStub(otherWindow, commands, local) {
  // build a connection to otherWindow, identifying ourselves as origin
  var qStub = Q_COMM.Connection(otherWindow, local, {origin: window.location.origin});
  // wrap the connection in an API, the result object has remote method calls
  return buildPromisingCalls(commands, qStub); 
}

exports.makeStub = makeStub;

function register(otherWindow, local, options) {

  var sux = Q_COMM.Connection(otherWindow, local, options);
  
  var remote = Object.create(Object.getPrototypeOf(sux));
  Object.keys(sux).forEach(function(property) {
    remote[property] = sux[property];
  });
  
  remote.discover = function (remoteName) {
    return remote.invoke('discover', remoteName).then(
      function(remoteAPI) {
        // Remote should give us json specification of function API
        return buildPromisingCalls(remoteName, remoteAPI, remote);
      }
    );
  };
  
  local.discover = function(localName) {
    var props = {};
    var theLocal = local[localName];
    if (theLocal) {
      Object.keys(theLocal).forEach(function(prop) {
        if (typeof theLocal[prop] === 'function') {
          props[prop] = true; 
        }
      });
    }
    return props;
  };

  return remote;
}

exports.register = register;

return exports;
  
});