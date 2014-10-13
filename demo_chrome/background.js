console.log('in background.js');

// Initialize freedom
var freedomScript = document.createElement('script');
freedomScript.src = 'freedom-for-chrome.js';
freedomScript.innerText = '{"stayLocal":true}';
freedomScript.setAttribute('data-manifest', 'demo.json');
document.body.appendChild(freedomScript);

var scripts = ['view-facebookauth.js', 'ux.js'];
for (var i = 0; i < scripts.length; ++i) {
  var s = document.createElement('script');
  s.src = scripts[i];
  document.body.appendChild(s);
}
