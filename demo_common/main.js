var social = freedom.socialprovider();
var users;


social.on('onUserProfile', function(data) {
  // emit to UX
  freedom.emit('recv-user', data);
});


social.on('onMessage', function(data) {
  // emit to UX
  console.log('in main.js onMessage, ', data);
  freedom.emit('recv-message', data);
});


freedom.on('send-message', function(data) {
  console.log('send-message called, data', data);
  // TODO: get rid of /client, use clients instead of users....
  social.sendMessage(data.userId + '/client', data.message).then(function() {
    console.log('successfully sent ' + data.message);
  });
});


function login() {
  userList = {};
  clientList = {};
  myClientState = null;
  social.login({}).then(function(ret) {
    myClientState = ret;
    console.log("Login successful: " + JSON.stringify(myClientState));
    if (ret.status == social.STATUS["ONLINE"]) {
      freedom.emit('recv-uid', ret.clientId);
      freedom.emit('recv-status', "online");
    } else {
      freedom.emit('recv-status', "offline");
    }
  }, function(err) {
    freedom.emit("recv-err", err);
  });
}

login();