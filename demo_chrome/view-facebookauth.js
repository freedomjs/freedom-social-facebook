var CREDENTIALS = "";

// uProxy app
var FACEBOOK_APP_ID = '161927677344933';
// test canvas app (dborkan's)
//var FACEBOOK_APP_ID = '1545014982395004';


var FACEBOOK_TOKENINFO_URL = 'https://graph.facebook.com/me?access_token=';
// publish_actions needed for posting to wall
// manage_notifications needed to read any notifications
// read_stream needed to read object.message within notification
var FACEBOOK_OAUTH_SCOPES = 'publish_actions,user_friends,manage_notifications,read_stream';
var REDIRECT_URI = "https://www.uproxy.org/";


var View_facebookAuth = function (app, dispatchEvent) {
  this.dispatchEvent = dispatchEvent;
  this.app = app;
};

View_facebookAuth.prototype.open = function (name, what, continuation) {
  continuation(false);
};

View_facebookAuth.prototype.show = function (continuation) {
  if (CREDENTIALS == '') {
    facebookAuth(this.dispatchEvent, continuation);
  } else {
    this.dispatchEvent('message', {cmd: 'auth', message: CREDENTIALS});
    continuation();
  }
};

View_facebookAuth.prototype.postMessage = function (args, continuation) {
  continuation();
};

View_facebookAuth.prototype.close = function (continuation) {
  continuation();
};

View_facebookAuth.prototype.onMessage = function (m) {
};

function facebookAuth(dispatchEvent, continuation) {
  function extractCode(tabId, changeInfo, tab) {
    var responseUrl = tab.url;
    if (responseUrl.indexOf(REDIRECT_URI) !== 0) {
      // User redirected to intermediate oauth URL, ignore.
      return;
    }
    var query = {};
    if (responseUrl && responseUrl.indexOf('#') >= 0) {
        var queryTok = responseUrl.substr(responseUrl.indexOf('#') + 1).split('&');
        for (var i = 0; i < queryTok.length; i++) {
            var tmp = queryTok[i].split('=');
            if (tmp.length > 1) {
                query[tmp[0]] = tmp[1];
            }
        }
    }
    var accessToken = query['access_token'];
    if (accessToken) {
      CREDENTIALS = {accessToken: accessToken};
      dispatchEvent('message', {cmd: 'auth', message: CREDENTIALS});
      continuation();
    } else {
      dispatchEvent('message',
                    {cmd: 'error', message: 'Access token not found'});
    }
    chrome.tabs.onUpdated.removeListener(extractCode);
    chrome.tabs.remove(tabId);
  };

  chrome.tabs.onUpdated.addListener(extractCode);
  var facebookUrl = 'https://www.facebook.com/dialog/oauth?' +
      'client_id=' + encodeURIComponent(FACEBOOK_APP_ID) +
      '&redirect_uri=' + encodeURIComponent(REDIRECT_URI) +
      '&scope=' + encodeURIComponent(FACEBOOK_OAUTH_SCOPES) +
      '&response_type=token';
  chrome.tabs.create({url: facebookUrl});
};

// Register with freedom as core.view provider.
window.freedomcfg = function(register) {
  console.log('registering View_facebookAuth');
  register("core.view", View_facebookAuth);
}
