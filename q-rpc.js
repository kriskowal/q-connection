// Google BSD license http://code.google.com/google_bsd_license.html
// Copyright 2011 Google Inc. johnjbarton@google.com

/*globals define window*/

define(['q-comm/q-comm'],
function(Q_COMM) {

  // A left paren ( followed by any not-right paren ) followed by right paren
  var reParamList = /\(([^\)]*)\)/; 
  var reParameters = /\(([^\)]*)\)/;


function buildPromisingCalls(iface, remote) {
  var stub = {};
  Object.keys(iface).forEach(function(method) {
    // functions on stub operate on remote
    stub[method] =  function() {
      var args = Array.prototype.slice.call(arguments);       
      return remote.invoke.apply(remote, [method].concat(args));
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

function makeStub(otherWindow, commands, eventHandlers) {
  // build a connection to otherWindow, identifying ourselves as origin
  var qStub = Q_COMM.Connection(otherWindow, eventHandlers, {origin: window.location.origin});
  // wrap the connection in an API, the result object has remote method calls
  return buildPromisingCalls(commands, qStub); 
}

return {
  makeStub: makeStub
  };
  
});