var ui = chrome.extension.getBackgroundPage().ui;
Polymer({
  ui: ui,
  send: function() {
    ui.sendMessage(this.messageText);
    this.messageText = '';
  }
});