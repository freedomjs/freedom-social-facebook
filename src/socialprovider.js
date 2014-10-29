/*globals freedom:true,setTimeout,console,VCardStore,global */
/*jslint indent:2,white:true,sloppy:true */

/**
 * Implementation of a Social provider for freedom.js that
 * uses the Facebook Graph API.
 **/

// TODO:
// - handle paging in comments and notifications
// - use storage for continuing comment threads, pictures
// - handle token refresh
// - add tests
// - detecting when a user has signed offline
// - last seen / active timestamps
// - things to try:
//   - editing existing comments / posts
//   - hiding posts rather than deleting them
//   - embed instance information in broadcast (may require uProxy change)

// Facebook place id for New York City, used as a default location for tagging
// users.
// TODO: what location to use?  We don't want to reveal users locations, nor
// give false locations.
var DEFAULT_USER_LOCATION = 111798695513697;

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
  this.debug = false;
  this.appFriends = {};
  this.notificationMonitorIntervalId_ = null;

  // TODO: clear on logout?
  this.storage = freedom['core.storage']();
};

/**
 * Begin the login view, potentially prompting for credentials.
 * @method login
 * @param {Object} loginOpts Setup information about the desired network.
     // TODO(dborkan): define options
 */
FacebookSocialProvider.prototype.login = function(loginOpts, continuation) {
  this.prefix = 'uproxy: ';  // TODO: get from loginOpts
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
  var meResp = this.makeGetRequest('me');
  this.myId = meResp.id;
  this.log('got meResp ', meResp);

  this.notificationCutoffTime_ = Date.now();
  this.monitorForIncomingMessages_();
  this.appFriends = this.getAppFriends_();
  continuation({
    userId: meResp.id,
    // TODO: include uProxy or instance info in the client?
    clientId: meResp.id + '/client',
    status: 'ONLINE',
    lastUpdated: Date.now(),
    lastSeen: Date.now()
  });
  // Emit onUserProfile so we get our own name
  this.dispatchEvent('onUserProfile', {
    userId: meResp.id,
    lastUpdated: Date.now(),
    name: meResp.name,
    url: '',
    imageData: ''
  });
};

/**
 * @method monitorForIncomingMessages_
 * @private
 */
FacebookSocialProvider.prototype.monitorForIncomingMessages_ = function() {
  return;  // TODO: handle this

  // TODO: ensure that this isn't called multiple times...  use clearInterval
  this.notificationMonitorIntervalId_ = setInterval(function() {
    var notificationsResp = this.makeGetRequest('me/notifications');
    this.log('got notifications ', notificationsResp);
    if (notificationsResp.data && notificationsResp.data.length > 0) {
      // TODO: speed this up by processing in order and stopping at cutoff?
      // Process notifications in ascending time order (reverse array order)

      // Use updated_time for notification, created_time for initial message and comments
      if (Date.parse(notificationsResp.data[0].updated_time) <=
          this.notificationCutoffTime_) {
        // No new notifications
        this.log('first notification from ' + Date.parse(notificationsResp.data[0].updated_time));
        this.log('cutoff is ' + this.notificationCutoffTime_);
        return;
      }

      for (var i = notificationsResp.data.length - 1; i >= 0; --i) {
        this.processNotification_(notificationsResp.data[i]);
      }
      // Update cutoff time to most recent notification.
      // TODO: what if 2 notifications happen at the exact same time?
      this.notificationCutoffTime_ = Date.parse(
          notificationsResp.data[0].updated_time);
      this.log('cutoff is now: ' + this.notificationCutoffTime_)
    }
  }.bind(this), 1000);
}

/**
 * @method getAppFriends_
 * @private
 */
FacebookSocialProvider.prototype.getAppFriends_ = function() {
  // TODO: check that these are correct!
  // TODO: what if user gave permissions for uproxy to post but not visible
  // to anyone?  can we detect this?  From quickly testing this it doesn't
  // seem to prevent messaging.....
  var permissionsResp = this.makeGetRequest('me/permissions');
  this.log('got permissionsResp ', permissionsResp);

  var appFriends = {};
  var appFriendsResp = this.makeGetRequest('me/friends');
  for (var i = 0; i < appFriendsResp.data.length; ++i) {
    var friend = appFriendsResp.data[i];
    var appFriend = new AppFriend(this, friend.id, friend.name);
    appFriends[friend.id] = appFriend;
    // TODO: dispatch events somewhere.
    // this.dispatchEvent('onUserProfile', appFriend.getUserProfile());
    // this.dispatchEvent('onClientState', appFriend.getClientState());
  }
  this.log('loaded appFriends: ', appFriends);
  return appFriends;
};


// TODO: document, this request is sync
FacebookSocialProvider.prototype.makeGetRequest = function(resourceStr,
                                                           asyncCallback) {
  // Default isAsync to false.
  var isAsync = asyncCallback ? true : false;

  // Create url from resourceStr and accessToken.
  var hasArgs = resourceStr.indexOf('?') >= 0;
  var url = ('https://graph.facebook.com/v2.1/' + resourceStr) + 
      (hasArgs ? '&' : '?') +
      'access_token=' + this.credentials['accessToken'];

  var xhr = new XMLHttpRequest();
  xhr.open('GET', url, isAsync);
  var response = undefined;
  xhr.addEventListener('load', function(event) {
    try {
      response = JSON.parse(xhr.response);
      if (asyncCallback) {
        asyncCallback(response);
      }
    }
    catch (e) {
      console.error(e);
    }
  }, false);
  xhr.addEventListener('error', function(evt) {
    console.error('Error occurred while making get request', evt);
  }, false);

  // xhr.send will block if isAsync==false
  xhr.send();
  return response;
};


FacebookSocialProvider.prototype.makePostRequest = function(resourceStr,
                                                            postArgs,
                                                            callback) {
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
      if (callback) {
        callback(response);
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
  // TODO: handle this
  return;
  // TODO: can you be spoofed?  what if a message is prefixed with uProxy:
  // but doesn't have the right privacy settings?

  // Check that message isn't before our cutoff time.
  var updatedTime = Date.parse(notification.updated_time);
  this.log('updatedTime ' + updatedTime);
  // TODO: what if there are 2 notifications at the same time?
  // TODO: can this be put in one place only?
  if (updatedTime <= this.notificationCutoffTime_) {
    this.log('ignoring message from before cutoff');
    return;
  }

  // Check that message is for uproxy.
  var notificationMessage = notification.object.message;
  this.log('got notificationMessage: ' + notificationMessage);

  // Check that message is from a friend.
  this.log('from: ' + notification.from.id);
  var appFriend = this.appFriends[notification.from.id];
  if (!appFriend) {
    console.warn('got uProxy message from non-appFriend user ' +
        notification.from.id);
    return;
  }

  // Any friend sending us a notification should be considered to ONLINE.
  // TODO: set a timeout to switch them to offline at some point in the future?
  if (appFriend.status != 'ONLINE') {
    appFriend.status = 'ONLINE';
    this.dispatchEvent('onClientState', appFriend.getClientState());
  }


  if (notificationMessage.indexOf(this.prefix) !== 0) {
    this.log('ignoring message: ' + notificationMessage);
    return;
  }

  // TODO: can we check that the message/comment was posted by the uproxy app?

  // Read the conversation (status) object.
  // TODO: move this to the AppFriend class?
  var myPostId = notification.object.id;
  var conversation = this.makeGetRequest(myPostId);
  this.log('conversation is ', conversation);
  // TODO: check for errors.
  // TODO: rename this to something more like most recent conversation id?
  appFriend.myPostId = myPostId;
  // TODO: > or >= ?
  if (Date.parse(conversation.created_time) > this.notificationCutoffTime_
      && conversation.from.id == appFriend.id) {
    // Conversation was created after notificationCutoffTime_, and was
    // initiated by the same person who gave us the notification (checked
    // to prevent emiting a message that was actually generated by the logged
    // in user).
    this.dispatchEvent('onMessage', {
      from: appFriend.getClientState(),
      message: conversation.message.substr(this.prefix.length)
    });
  }
  if (conversation.comments && conversation.comments.data) {
    var comments = conversation.comments.data;
    // TODO: come up with something better than linear search through comments!
    for (var i = 0; i < comments.length; ++i) {
      var comment = comments[i];
      this.log('reading comment, ', comment);
      if (comment.from.id != appFriend.id) {
        // Comment not from friend (may be from ourselves), ignore.
        this.log('ignoring comment not from friend', comment);
        continue;
      } else if (comment.message.indexOf(this.prefix) !== 0) {
        // Comment not through uproxy, ignore.
        this.log('ignoring comment:', comment);
        continue;
      } else if (Date.parse(comment.created_time) <=
          this.notificationCutoffTime_) {
        // Comment is before cutoff time
        this.log('ignoring old comment', comment);
        continue;
      }
      // Got a new comment!
      // TODO: refactor this to not duplicate code
      this.dispatchEvent('onMessage', {
        from: appFriend.getClientState(),
        message: comment.message.substr(this.prefix.length)
      });
    }
  }
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
  if (appFriend.myPostId) {
    // Post a comment on the existing conversation.
    this.makePostRequest(appFriend.myPostId + '/comments',
        {message: this.prefix + msg},
        function(response) {
          console.log('got response from posting comment', response);
          setTimeout(function() {
            // Delete comment sometime after it's been posted.
            this.makeDeleteRequest_(response.id);
          }.bind(this), 5000);  // TODO: constant
        }.bind(this));
  } else {
    // Create a new conversation.
    this.makePostRequest('me/feed',
        {
          privacy: "{'allow': '" + appFriend.id + "', 'value': 'CUSTOM'}",
          tags: "'" + appFriend.id  + "'",
          place: DEFAULT_USER_LOCATION,
          message: this.prefix + msg
        },
        function(response) {
          appFriend.myPostId = response.id;  // TODO: verify this is correct
        }.bind(this));
  }
  continuation();
};

FacebookSocialProvider.prototype.logout = function(continuation) {
  this.appFriends = {};
  clearInterval(this.notificationMonitorIntervalId_);
  // TODO: do I need to emit stuff?
  continuation();
};

FacebookSocialProvider.prototype.log = function() {
  if (this.debug) {
    console.log.apply(console, arguments);
  }
}

function AppFriend(facebookSocialProvider, id, name) {
  this.facebookSocialProvider = facebookSocialProvider;
  this.id = id;
  this.name = name;
  this.picture = null;
  this.lastUpdated = Date.now();
  this.lastSeen = Date.now();
  this.myPostId = null;
  this.myCommentId = null;

  // Friend is considered offline until we get the first message from them
  // TODO: how does this go back to offline when they logout?
  this.status = 'OFFLINE';

  this.getFromStorage().then(function(result) {
    console.log('getFromStorage returned', result);

    var allPromises = [];

    // Get picture.
    // TODO: error handling for these...
    allPromises.push(this.loadPicture(result));

    // Get myPostId and myCommentId (1:1 conversation thread with friend).
    allPromises.push(
        this.loadMyPostId(result)
            .then(this.loadMyCommentId.bind(this)));

    // TODO: should I wait to get status from friend before emitting?
    // what about offline users?  they need to emit instantly

    Promise.all(allPromises).then(function() {
      console.log('dispatching appFriend profile and client after loading from storage');
      this.facebookSocialProvider.dispatchEvent('onUserProfile', this.getUserProfile());
      this.facebookSocialProvider.dispatchEvent('onClientState', this.getClientState());
    }.bind(this));
  }.bind(this)).catch(function(e) {
    console.error('error loading user from storage', e);
  }.bind(this));
}

AppFriend.prototype.loadPicture = function(storageResult) {
  if (storageResult && storageResult.picture) {
    this.picture = storageResult.picture;
    return Promise.resolve();
  }

  return new Promise(function(fulfill, reject) {
    this.facebookSocialProvider.makeGetRequest(
        this.id + '/picture?redirect=false',
        function(response) {
          if (response.data && response.data.url) {
            this.picture = response.data.url;
            this.writeToStorage();
            fulfill();
          } else {
            reject('Error in response' + response);
          }
        }.bind(this));
  }.bind(this));
}

AppFriend.prototype.loadMyPostId = function(storageResult) {
  if (storageResult && storageResult.myPostId) {
    console.log('using cached postId ' + storageResult.myPostId);
    this.myPostId = storageResult.myPostId;
    return Promise.resolve();
  }

  return new Promise(function(fulfill, reject) {
    this.facebookSocialProvider.makePostRequest('me/feed',
        {
          privacy: "{'allow': '" + this.id + "', 'value': 'CUSTOM'}",
          tags: "'" + this.id  + "'",
          place: DEFAULT_USER_LOCATION,
          message: this.facebookSocialProvider.prefix + 'Hello from uProxy at ' + Date.now()  // TODO: come up with something nice
        },
        function(response) {
          // TODO: error handling?
          console.log('setting myPostId to ' + response.id);
          this.myPostId = response.id;
          this.writeToStorage();
          fulfill();
        }.bind(this));
  }.bind(this));
}

AppFriend.prototype.loadMyCommentId = function(storageResult) {
  console.log('loadMyCommentId called, this.myPostId is ' + this.myPostId);
  if (storageResult && storageResult.myCommentId) {
    this.myCommentId = storageResult.myCommentId;
    return Promise.resolve();
  }

  // TODO: this is wrong!
  return new Promise(function(fulfill, reject) {
    console.log('making post request to ' +  this.myPostId + '/comments')
    var message = this.facebookSocialProvider.prefix + 'initializing comment';
    console.log('sending comment message ' + message);
    this.facebookSocialProvider.makePostRequest(this.myPostId + '/comments',
        {message: message},
        function(response) {
          // TODO: error handling?
          console.log('setting myCommentId to ' + response.id);
          this.myCommentId = response.id;
          fulfill();
        }.bind(this));
  }.bind(this));
}

AppFriend.prototype.getStorageKey = function() {
  // TODO: do user ids change periodically?  How will this affect storage
  return this.facebookSocialProvider.myId + '-' + this.id;
}

AppFriend.prototype.getFromStorage = function() {
  return this.facebookSocialProvider.storage.get(this.getStorageKey())
      .then(function(result) {
    console.log('got storage result for user ' + this.id + ', ', result);
    try {
      return Promise.resolve(JSON.parse(result));
    } catch (e) {
      return Promise.resolve({});
    }
  }.bind(this));
};

AppFriend.prototype.writeToStorage = function() {
  var data = {
    picture: this.picture,
    myPostId: this.myPostId,
    myCommentId: this.myCommentId
  };
  // Store as JSON string.
  this.facebookSocialProvider.storage.set(this.getStorageKey(),
                                          JSON.stringify(data));
};

AppFriend.prototype.getClientState = function() {
  return {
    userId: this.id,
    clientId: this.getClientId(),
    status: this.status,
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
