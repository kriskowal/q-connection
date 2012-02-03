define([], function () {
	// http://stackoverflow.com/questions/105034/how-to-create-a-guid-uuid-in-javascript
        // http://note19.com/2007/05/27/javascript-guid-generator/
function guidGenerator() {
    var S4 = function() {
       return (((1+Math.random())*0x10000)|0).toString(16).substring(1);
    };
    return (S4()+S4()+"-"+S4()+"-"+S4()+"-"+S4()+"-"+S4()+S4()+S4());
}

return guidGenerator;
});