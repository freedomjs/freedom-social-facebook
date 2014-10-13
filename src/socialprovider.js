/*globals freedom:true,setTimeout,console,VCardStore,global */
/*jslint indent:2,white:true,sloppy:true */

/**
 * Implementation of a Social provider for freedom.js that
 * uses the Facebook Graph API.
 **/


// Global declarations for node.js
if (typeof global !== 'undefined') {
  if (typeof window === 'undefined') {
    global.window = {};
  }
  if (typeof XMLHttpRequest === 'undefined') {
    global.XMLHttpRequest = {};
  }
} else {
  if (typeof window === 'undefined') {
    window = {};
  }
  if (typeof XMLHttpRequest === 'undefined') {
    XMLHttpRequest = {};
  }
}

/**
 * The SocialProvider implements the freedom.js social API.
 * @class FacebookSocialProvider
 * @constructor
 */
var FacebookSocialProvider = function(dispatchEvent) {
  this.dispatchEvent = dispatchEvent;
  var social = freedom.social();
  this.ERRCODE = social.ERRCODE;
  this.credentials = null;
  this.debug = true;
  this.appFriends = {};
};

/**
 * Begin the login view, potentially prompting for credentials.
 * @method login
 * @param {Object} loginOpts Setup information about the desired network.
     // TODO(dborkan): define options
 */
FacebookSocialProvider.prototype.login = function(loginOpts, continuation) {
  if (this.credentials) {
    // Already have login credentials, load buddylist
    // TODO: clear state?
    this.completeLogin_(continuation);
    return;
  }

  // Show login view to get credentials.
  if (!this.view) {
    this.view = freedom['core.view']();
  } else {
    this.view.close();
    this.view = freedom['core.view']();
  }
  this.view.once('message', this.onCredentials_.bind(this, continuation));
  this.view.open('FacebookLogin', {file: 'login.html'})
      .then(this.view.show.bind(this.view));
};

/**
 * Get credentials back from the view.
 * @method onCredentials_
 * @private
 * @param {function} continuation call to complete the login promise.
 * @param {Object} msg The message sent from the authentication view.
 */
FacebookSocialProvider.prototype.onCredentials_ = function(continuation, msg) {
  if (msg.cmd && msg.cmd === 'auth') {
    this.credentials = msg.message;
    this.view.close();
    this.completeLogin_(continuation);
  } else if (msg.cmd && msg.cmd === 'error') {
    continuation(undefined, this.ERRCODE.LOGIN_FAILEDCONNECTION);
  } else {
    continuation(undefined, this.ERRCODE.LOGIN_BADCREDENTIALS);
  }
};

FacebookSocialProvider.prototype.completeLogin_ = function(continuation) {
  this.notificationCutoffTime_ = Date.now();
  this.monitorForIncomingMessages_();
  this.loadBuddyList_();

  // TODO: pass my client state
  continuation();
}

/**
 * @method monitorForIncomingMessages_
 * @private
 */
FacebookSocialProvider.prototype.monitorForIncomingMessages_ = function() {
  // TODO: ensure that this isn't called multiple times...  use clearInterval
  setInterval(function() {
    var notificationsResp = this.makeGetRequest_('me/notifications');
    this.log('got notifications ', notificationsResp);
    if (notificationsResp.data) {
      // TODO: speed this up by processing in order and stopping at cutoff?
      // Process notifications in ascending time order (reverse array order)

      if (Date.parse(notificationsResp.data[0].created_time) <=
          this.notificationCutoffTime_) {
        // No new notifications
        return;
      }

      for (var i = notificationsResp.data.length - 1; i >= 0; --i) {
        this.processNotification_(notificationsResp.data[i]);
      }
      // Update cutoff time to most recent notification.
      // TODO: what if 2 notifications happen at the exact same time?
      this.notificationCutoffTime_ = Date.parse(
          notificationsResp.data[0].created_time);
      this.log('cutoff is now: ' + this.notificationCutoffTime_)
    }
  }.bind(this), 1000);
}

/**
 * @method loadBuddyList_
 * @private
 */
FacebookSocialProvider.prototype.loadBuddyList_ = function() {
  var meResp = this.makeGetRequest_('me');
  this.log('got meResp ', meResp);

  // TODO: check that these are correct!
  // TODO: what if user gave permissions for uproxy to post but not visible
  // to anyone?  can we detect this?  From quickly testing this it doesn't
  // seem to prevent messaging.....
  var permissionsResp = this.makeGetRequest_('me/permissions');
  this.log('got permissionsResp ', permissionsResp);

  var appFriendsResp = this.makeGetRequest_('me/friends');
  for (var i = 0; i < appFriendsResp.data.length; ++i) {
    var friend = appFriendsResp.data[i];
    // TODO: how to get picture?
    var appFriend = new AppFriend(friend.id, friend.name, null);
    this.appFriends[friend.id] = appFriend;
    this.dispatchEvent('onUserProfile', appFriend.getUserProfile());
    this.dispatchEvent('onClientState', appFriend.getClientState());
  }
  this.log('loaded appFriends: ', this.appFriends);
};


// TODO: document, this request is sync
FacebookSocialProvider.prototype.makeGetRequest_ = function(resourceStr) {
  // Create url from resourceStr and accessToken.
  var hasArgs = resourceStr.indexOf('?') >= 0;
  var url = ('https://graph.facebook.com/v2.1/' + resourceStr) + 
      (hasArgs ? '&' : '?') +
      'access_token=' + this.credentials['accessToken'];

  var xhr = new XMLHttpRequest();
  xhr.open('GET', url, false);  // sync
  var response = null;
  xhr.addEventListener('load', function(event) {
    try {
      response = JSON.parse(xhr.response);
    }
    catch (e) {
      console.error(e);
    }
  }, false);
  xhr.addEventListener('error', function(evt) {
    console.error('Error occurred while making get request', evt);
  }, false);

  // xhr.send will block (due to async=false) until response is returned.
  xhr.send();
  return response;
};


FacebookSocialProvider.prototype.makePostRequest_ = function(resourceStr,
                                                             postArgs) {
  // Create url from resourceStr and accessToken.
  var url = 'https://graph.facebook.com/v2.1/' + resourceStr + '?' + 
      'access_token=' + this.credentials['accessToken'];

  var xhr = new XMLHttpRequest();
  xhr.open('POST', url, true);  // async
  xhr.addEventListener('load', function(event) {
    try {
      var response = JSON.parse(xhr.response);
      this.log('got response ', response);
      if (response.error) {
        console.error('Error sending message, ', response.error);
      }
    }
    catch (e) {
      console.error(e);
    }
  }.bind(this), false);
  xhr.addEventListener('error', function(evt) {
    // TODO: this is an error reaching the server, not necessarily an error
    // returned from the server
    console.error('Error occurred while making post request', evt);
  }.bind(this), false);

  var allArgs = {};
  allArgs['accesss_token'] = this.credentials['accessToken'];  // TODO: needed?
  for (x in postArgs) {
    allArgs[x] = postArgs[x];
  }
  this.log('allArgs ', allArgs);
  var postString = urlEncode(allArgs);
  this.log('postString: ' + postString);
  xhr.send(postString);
};


function urlEncode(obj) {
  var str = ''
  for (var i in obj) {
    if (str != '') {
      str += '&';
    }
    str += encodeURIComponent(i) + '=' + encodeURIComponent(obj[i]);
  }
  return str;
}


FacebookSocialProvider.prototype.processNotification_ = function(notification) {
  // TODO: check timestamps and such so we don't process multiple times
  // TODO: check that it's actually relevant for uProxy
  // TODO: what if someone spoofs you?  e.g. a non-uProxy contact

  // Check that message isn't before our cutoff time.
  var createdTime = Date.parse(notification.created_time);
  this.log('createdTime ' + createdTime);
  // TODO: what if there are 2 notifications at the same time?
  if (createdTime <= this.notificationCutoffTime_) {
    this.log('ignoring message from before cutoff');
    return;
  }

  // Check that message is for uproxy
  var message = notification.object.message;
  this.log('got message: ' + message);
  if (message.indexOf('uproxy: ') !== 0) {  // TODO: make the uproxy prefix const
    this.log('ignoring message not for uproxy: ' + message);
    return;
  }

  // check that message is from a friend
  this.log('from: ' + notification.from.id);
  var appFriend = this.appFriends[notification.from.id];
  if (!appFriend) {
    console.warn('got uProxy message from non-appFriend user ' +
        notification.from.id);
    return;
  }

  this.dispatchEvent('onMessage', {
    from: {
      userId: appFriend.id,
      clientId: appFriend.getClientId(),
      status: 'ONLINE',  // TODO: what to put?
      lastUpdated: appFriend.lastUpdated, // TODO: what to put?
      lastSeen: appFriend.lastSeen, // TODO: what to put?
    },
    message: message.substr('uproxy: '.length)
  });
}


/**
 * Clear any credentials / state in the app.
 * @method clearCachedCredentials
 */
FacebookSocialProvider.prototype.clearCachedCredentials  = function(continuation) {
  delete this.credentials;
  continuation();
};

/**
 * Returns all the <client_state>s that we've seen so far (from any 'onClientState' event)
 * Note: this instance's own <client_state> will be somewhere in this list
 * Use the clientId returned from social.login() to extract your element
 * 
 * @method getClients
 * @return {Object} { 
 *    'clientId1': <client_state>,
 *    'clientId2': <client_state>,
 *     ...
 * } List of <client_state>s indexed by clientId
 *   On failure, rejects with an error code (see above)
 */
FacebookSocialProvider.prototype.getClients = function(continuation) {
  return getValues(this.appFriends).map(
      function(x) { return x.getClientState(); });
};

FacebookSocialProvider.prototype.getUsers = function(continuation) {
  return getValues(this.appFriends).map(
      function(x) { return x.getUserProfile(); });
};

// TODO: make map values
function getValues(obj) {
  var values = [];
  for (var i in obj) {
    values.push(obj[i]);
  }
  return values;
}

function clientIdToUserId(clientId) {
  return clientId.substr(0, clientId.lastIndexOf('/'));
}

/**
 * Sends a message to a user on the network.
 * If the destination is not specified or invalid, the message is dropped.
 * @method sendMessage
 * @param {String} to clientId of the device or user to send to.
 * @param {String} msg The message to send
 * @param {Function} continuation Callback after message is sent.
 */
FacebookSocialProvider.prototype.sendMessage = function(to, msg, continuation) {
  // TODO:
  // this only allows sending to other uProxy users...
  // and only works if the oauth token has publish_actions permission
  // uProxy can do this but needs review before 4/30/2015
  // new apps can't do this

  // TODO: look into making this a custom story...then can it be hidden?????
  var appFriend = this.appFriends[clientIdToUserId(to)];
  if (!appFriend) {
    console.warn('Friend not found using this app ' + to);
    //  TODO: better error for ONLINE_WITH_OTHER_APP
    continuation(undefined, this.ERRCODE.OFFLINE);
    return;
  }
  var id = appFriend.id;
  this.makePostRequest_('me/feed',
      {
        privacy: "{'allow': '" + id + "', 'value': 'CUSTOM'}",
        tags: "'" + id  + "'",
        place: 111798695513697, // New York City, TODO: define
        message: 'uproxy: ' + msg
      });
  continuation();
};

FacebookSocialProvider.prototype.logout = function(continuation) {
  this.appFriends = {};
  // TODO: do I need to emit stuff?
  continuation();
};

FacebookSocialProvider.prototype.log = function() {
  if (this.debug) {
    console.log.apply(console, arguments);
  }
}

inherits = function(childCtor, parentCtor) {
  function tempCtor() {};
  tempCtor.prototype = parentCtor.prototype;
  childCtor.superClass_ = parentCtor.prototype;
  childCtor.prototype = new tempCtor();
  childCtor.prototype.constructor = childCtor;
  childCtor.base = function(me, methodName, var_args) {
    var args = Array.prototype.slice.call(arguments, 2);
    return parentCtor.prototype[methodName].apply(me, args);
  };
};

function AppFriend(id, name, picture) {
  this.id = id;
  this.name = name;
  this.picture = picture;
  this.lastUpdated = Date.now();
  this.lastSeen = Date.now();
}

AppFriend.prototype.getClientState = function() {
  return {
    userId: this.id,
    clientId: this.getClientId(),
    status: 'ONLINE',
    lastUpdated: this.lastUpdated,
    lastSeen: this.lastSeen
  };
}

AppFriend.prototype.getClientId = function() {
  return this.id + '/client';
};

AppFriend.prototype.getUserProfile = function() {
  return {
    userId: this.id,
    name: this.name,
    imageData: this.picture,
    lastUpdated: this.lastUpdated
  };
}

// Register provider when in a module context.
if (typeof freedom !== 'undefined') {
  freedom.social().provideAsynchronous(FacebookSocialProvider);
}
