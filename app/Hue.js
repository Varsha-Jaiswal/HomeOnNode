'use strict';

var EventEmitter = require('events').EventEmitter;
var util = require('util');
var diff = require('deep-diff').diff;
var hueApi = require('node-hue-api');
var log = require('./SystemLog');

function Hue(key, ip) {
  var bridgeKey = key;
  var bridgeIP = ip;
  var hueBridge;
  this.hueLights = null;
  this.hueGroups = null;
  this.refreshInterval = 1;
  this.defaultRefreshInterval = 20000;
  var self = this;

  this.setLightState = function(lights, cmd, callback) {
    if (hueBridge) {
      lights.forEach(function(light) {
        var result;
        var msg;
        msg = '[HUE] Light: [id] Set to: ' + JSON.stringify(cmd);
        msg = msg.replace('[id]', light);
        try {
          if (light <= 0) {
            light = Math.abs(light);
            result = hueBridge.setGroupLightState(light, cmd);
          } else {
            result = hueBridge.setLightState(light, cmd);
          }
          log.log(msg);
        } catch (ex) {
          log.exception(msg, ex);
          self.emit('error');
        }
        if (result === false) {
          msg = '[HUE] Error setting light [' + light + '] state to ';
          msg += JSON.stringify(cmd);
          log.error(msg);
        }
      });
    }
  };

  this.getGroups = function(callback) {
    if (hueBridge) {
      try {
        hueBridge.groups(callback);
      } catch (ex) {
        log.exception('[HUE] Unable to get groups.', ex);
        if (callback) {
          callback(ex, null);
        }
      }
    }
  };

  this.getGroup = function(id, callback) {
    if (hueBridge) {
      try {
        hueBridge.getGroup(id, callback);
      } catch (ex) {
        log.exception('[HUE] Unable to get group id:' + id, ex);
        if (callback) {
          callback(ex, null);
        }
      }
    }
  };

  this.createGroup = function(label, lights, callback) {
    if (hueBridge) {
      try {
        hueBridge.createGroup(label, lights, callback);
      } catch (ex) {
        log.exception('[HUE] Unable to create group', ex);
        if (callback) {
          callback(ex, null);
        }
      }
    }
  };

  this.updateGroup = function(id, label, lights, callback) {
    if (hueBridge) {
      try {
        hueBridge.updateGroup(id, label, lights, callback);
      } catch (ex) {
        log.exception('[HUE] Unable to update group', ex);
        if (callback) {
          callback(ex, null);
        }
      }
    }
  };

  this.deleteGroup = function(id, callback) {
    if (hueBridge) {
      try {
        hueBridge.deleteGroup(id, callback);
      } catch (ex) {
        log.exception('[HUE] Unable to delete group', ex);
        if (callback) {
          callback(ex, null);
        }
      }
    }
  };

  this.searchForNewLights = function(callback) {
    if (hueBridge) {
      try {
        hueBridge.searchForNewLights(callback);
      } catch (ex) {
        log.exception('[HUE] Unable to search for new lights', ex);
        if (callback) {
          callback(ex, false);
        }
      }
    }
  };

  this.getNewLights = function(callback) {
    if (hueBridge) {
      try {
        hueBridge.newLights(callback);
      } catch (ex) {
        log.exception('[HUE] Could not return new lights', ex);
        if (callback) {
          callback(ex, null);
        }
      }
    }
  };

  this.setLightName = function(id, label, callback) {
    if (hueBridge) {
      try {
        hueBridge.setLightName(id, label, callback);
      } catch (ex) {
        log.exception('[HUE] Could not set light name', ex);
        if (callback) {
          callback(ex, null);
        }
      }
    }
  };

  function monitorHue() {
    setTimeout(function() {
      hueBridge.getFullState(function(err, hueState) {
        if (err) {
          log.exception('[HUE] Unable to retrieve light state.', err);
          if (self.refreshInterval < self.defaultRefreshInterval * 10) {
            self.refreshInterval += 2500;
          } else {
            log.error('[HUE] Exceeded maximum timeout, throwing error.');
            self.emit('error');
          }
        } else {
          var diffLights = diff(self.hueLights, hueState.lights);
          var diffGroups = diff(self.hueGroups, hueState.groups);
          if (diffLights || diffGroups) {
            self.hueLights = hueState.lights;
            self.hueGroups = hueState.groups;
            self.emit('change', hueState.lights, hueState.groups);
          }
          self.refreshInterval = self.defaultRefreshInterval;
        }
        monitorHue();
      });
    }, self.refreshInterval);
  }

  function init() {
    if (bridgeIP === null || bridgeIP === undefined) {
      log.init('[HUE] No bridge IP set, starting search.');
      hueApi.nupnpSearch(function(err, result) {
        if (err) {
          log.exception('[HUE] Error searching for Hue Bridge', err);
          self.emit('error');
        } else if (result.length === 0) {
          log.error('[HUE] No Hue bridges found.');
          self.emit('error');
        } else {
          if (result.length > 1) {
            log.warn('[HUE] Multiple bridges found, will use the first.');
          }
          log.debug('[HUE] Bridge found: ' + JSON.stringify(result[0]));
          bridgeIP = result[0].ipaddress;
          init();
        }
      });
    } else {
      log.init('[HUE] on IP: ' + bridgeIP);
      hueBridge = hueApi.HueApi(bridgeIP, bridgeKey);
      log.log('[HUE] Ready.');
      self.emit('ready');
      monitorHue();
    }
  }

  init();
}

util.inherits(Hue, EventEmitter);

module.exports = Hue;