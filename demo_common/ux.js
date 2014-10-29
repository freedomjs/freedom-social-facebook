function UserInterface() {
  this.users = [];
  this.messages = [];
  this.selectedUser;

  freedom.on('recv-user', function(data) {
    console.log('recv-user called in ux.js, ', data);
    // Remove user from array if they already exist.
    for (var i = 0; i < this.users.length; ++i) {
      if (this.users[i].userId == data.userId) {
        this.users.splice(i, 1);
        break;
      }
    }
    this.users.push(data);
  }.bind(this));

  freedom.on('recv-message', function(data) {
    console.log('in ux.js recv-message, ', data);
    this.messages.push(data);
  }.bind(this));
}

UserInterface.prototype.select = function(user) {
  console.log('in ux.js, selecting ', user);
  this.selectedUser = user;
}

UserInterface.prototype.sendMessage = function(text) {
  if (!this.selectedUser) {
    console.error('cannot send message without selectedUser');
    return;
  }
  freedom.emit('send-message',
      {userId: this.selectedUser.userId, message: text});
}

var ui;
window.onload = function() {
  ui = new UserInterface();
}

