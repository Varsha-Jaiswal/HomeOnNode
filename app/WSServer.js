'use strict';

const EventEmitter = require('events').EventEmitter;
const log = require('./SystemLog2');
const util = require('util');
const WebSocket = require('ws');

/**
 * WebSocket Server
 * @constructor
 *
 * @fires WSServer#message
 * @param {String} name Name of the WebSocket Server.
 * @param {Number} port Port to listen on.
*/
function WSServer(name, port) {
  const PING_INTERVAL = 30 * 1000;
  const _self = this;
  this.running = false;
  let _logPrefix = name.toUpperCase() + '_WSS';
  let _wss;

  /**
   * Init the WebSocket Server
  */
  function _init() {
    if (!port) {
      port = 8881;
    }
    log.init(_logPrefix, `Starting WebSocket server on port ${port}`);
    try {
      _wss = new WebSocket.Server({port: port});
    } catch (ex) {
      log.error(_logPrefix, 'Unable to start WebSocket server', ex);
      return;
    }
    _self.running = true;
    log.log(_logPrefix, 'WebSocket server started...');
    _wss.on('connection', _wsConnection);
    _wss.on('error', _wsError);
    _wss.on('message', _wsMessage);
    setInterval(_pingClients, PING_INTERVAL);
  }

  /**
   * Handles an incoming message
   *
   * @param {String} msg Incoming message, expect JSON-able string.
   */
  function _wsMessage(msg) {
    try {
      msg = JSON.parse(msg);
    } catch (ex) {
      log.error(_logPrefix, `Unable to parse message ${msg}`, ex);
      return;
    }
    _self.emit('message', msg);
  }

  /**
   * Handles incoming connection
   *
   * @param {Object} ws WebSocket connection.
   * @param {Object} request Original HTTP Request.
   */
  function _wsConnection(ws, request) {
    ws.isAlive = true;
    ws.on('pong', () => {
      ws.isAlive = true;
    });
    let fromIP = 'unknown';
    if (request && request.connection && request.connection.remoteAddress) {
      fromIP = request.connection.remoteAddress;
    }
    log.log(_logPrefix, `Client connected from ${fromIP}`);
  }

  /**
   * Handles errors
   *
   * @param {Error} err The incoming error.
   */
  function _wsError(err) {
    log.error(_logPrefix, 'Unknown error', err);
  }

  /**
   * Pings the connected clients to ensure they're still connected
   */
  function _pingClients() {
    _wss.clients.forEach((ws) => {
      if (ws.isAlive === false) {
        return ws.terminate();
      }
      ws.isAlive = false;
      ws.ping('', false, true);
    });
  }

  this.broadcast = function(msg) {
    if (!_wss) {
      log.error(_logPrefix, 'Unable to broadcast, server is not running.');
      return;
    }
    _wss.clients.forEach((ws) => {
      if (ws.readyState === WebSocket.OPEN && ws.isAlive === true) {
        try {
          ws.send(msg, (err) => {
            if (err) {
              ws.isAlive = false;
              log.error(_logPrefix, 'Error sending message to client', err);
            }
          });
        } catch (ex) {
          ws.isAlive = false;
          log.exception(_logPrefix, 'Exception sending message to client.', ex);
        }
      }
    });
  };

  _init();
}
util.inherits(WSServer, EventEmitter);

module.exports = WSServer;