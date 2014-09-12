var EventEmitter = require("events").EventEmitter;
var util = require("util");
var XMPP = require("node-xmpp");
var log = require("./SystemLog");


function Harmony(ip, uuid) {
  var _ip = ip;
  var _uuid = uuid;
  var _connectionString = {
    jid: uuid + "@connect.logitech.com/gatorade.",
    password: uuid,
    host: _ip,
    domain: "@connect.logitech.com/gatorade."
  };
  var client;
  var _self = this;
  this.currentActivity = -100;
  var reconnect = true;

  function connect() {
    client = new XMPP.Client(_connectionString);
    client.on("error", handleError);
    client.on("online", handleOnline);
    client.on("stanza", handleStanza);
    client.on("offline", handleOffline);
    client.on("connect", handleConnect);
    client.on("reconnect", handleReconnect);
    client.on("disconnect", handleDisconnect);
    log.debug("[HARMONY] connect.");
  }

  function handleError(err) {
    _self.emit("error", err);
  }

  function handleOnline(connection) {
    log.debug("[Harmony] Online. " + String(connection.toString));
    _self.emit("ready", connection);
    keepAlive();
  }

  function handleStanza(data) {
    var result;
    if (data.children.length >= 1) {
      var child = data.children[0];
      if (child["attrs"]["mime"] === "vnd.logitech.harmony/vnd.logitech.harmony.engine?config") {
        result = child.children.join("");
        result = JSON.parse(result);
        _self.emit("config", result);
        log.debug("[Harmony] handleStanza(log)");
      } else if (child["attrs"]["mime"] === "vnd.logitech.harmony/vnd.logitech.harmony.engine?getCurrentActivity") {
        result = child.children.join("");
        result = result.split("=");
        _self.emit("activity", result[1]);
        _self.currentActivity = result[1];
        log.debug("[Harmony] handleStanza(getCurrentActivity) " + result[1]);
      } else if (child["attrs"]["type"] === "harmony.engine?startActivityFinished") {
        result = child.children.join("");
        result = result.split(":");
        for (var i = 0; i < result.length; i++) {
          if (result[i].indexOf("activityId") === 0) {
            result = result[i].split("=");
            _self.emit("activity", result[1]);
            _self.currentActivity = result[1];
            log.debug("[Harmony] handleStanza(startActivityFinished) " + result[1]);
            break;
          } // if
        } // fpr
      } else {
        log.warn("[Harmony] Unhandled response. <" + child.name + " ... />");
      } // End of IF statements
    } // There is at least one child
  } // End of function

  function handleOffline() {
    log.debug("[Harmony] Offline.");
    if (reconnect) {
      connect();
    }
  }

  function handleConnect(connection) {
    log.debug("[Harmony] Connected. " + String(connection));
    //console.log("-CONNECT", a, b);
  }

  function handleReconnect() {
    log.debug("[Harmony] Reconnected.");
  }

  function handleDisconnect() {
    log.debug("[Harmony] Disconnected.");
  }

  function keepAlive() {
    //log.debug("[HARMONY] KeepAlive");
    if (client !== undefined) {
      var cmd = new XMPP.Element("iq", {"id": _uuid});
      client.send(cmd);
    }
    setTimeout(function() {
      if (reconnect) {
        keepAlive();
      }
    }, 15*1000);
  }

  this.getConfig = function() {
    if (client === undefined) {
      _self.emit("error", "Client not connected.");
      return {"error": "Client not connected"};
    } else {
      log.debug("[Harmony] getConfig.");
      var cmd = new XMPP.Element("iq", {"id": _uuid})
        .c("oa", {
          "xmlns": "connect.logitech.com",
          "mime": "vnd.logitech.harmony/vnd.logitech.harmony.engine?config"
        });
      client.send(cmd);
      return {"action": "getConfig"};
    }
  };

  this.getActivity = function(callback) {
    if (client === undefined) {
      _self.emit("error", "Client not connected.");
      return {"error": "Client not connected"};
    } else {
      log.debug("[Harmony] getActivity.");
      var cmd = new XMPP.Element("iq", {"id": _uuid})
        .c("oa", {
          "xmlns": "connect.logitech.com",
          "mime": "vnd.logitech.harmony/vnd.logitech.harmony.engine?getCurrentActivity"
        });
      client.send(cmd);
      return {"action": "getActivity"};
    }
  };

  this.setActivity = function(activityID) {
    if (client === undefined) {
      _self.emit("error", "Client not connected.");
      return {"error": "Client not connected"};
    } else {
      log.debug("[Harmony] setActivity.");
      var cmdText = "activityId=" + activityID.toString() + ":timestamp=0";
      var cmd = new XMPP.Element("iq", {"id": _uuid, "type": "get"})
        .c("oa", {
          "xmlns": "connect.logitech.com",
          "mime": "harmony.engine?startactivity"
        }).t(cmdText);
      client.send(cmd);
      return {"action": "setActivity", "activityID": activityID};
    }
  };

  this.close = function() {
    reconnect = false;
    if (client === undefined) {
      return {"error": "Client not connected"};
    } else {
      log.debug("[Harmony] close()");
      client.end();
      client = undefined;
      return {"action": "close"};
    }
  };

  connect();
}

util.inherits(Harmony, EventEmitter);

module.exports = Harmony;
