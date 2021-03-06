/* eslint no-console: ["error", { "allow": ["error"] }] */

'use strict';

const fs = require('fs');
const log = require('./SystemLog2');
const Keys = require('./Keys').keys;
const GCMPush = require('./GCMPush');
const Firebase = require('firebase');
const WSClient = require('./WSClient');
const DeviceMonitor = require('./DeviceMonitor');

let GPIO;

let _fb;
let _config;
let _gcmPush;
let _wsClient;
let _deviceMonitor;
let _hasReadFBConfig = false;

const EDGES = ['none', 'rising', 'falling', 'both'];

// Read config file
try {
  // eslint-disable-next-line no-console
  console.log(`Reading 'config.json'...`);
  let config = fs.readFileSync('config.json', {encoding: 'utf8'});
  // eslint-disable-next-line no-console
  console.log(`Parsing 'config.json'...`);
  _config = JSON.parse(config);
} catch (ex) {
  console.error(`Unable to read or parse 'config.json'`);
  console.error(ex);
  process.exit(1);
}

// Verify config has appName
if (!_config.appName) {
  console.error(`'appName' not set in config.`);
  process.exit(1);
}
const APP_NAME = _config.appName;
const FB_LOG_PATH = `logs/${APP_NAME.toLowerCase()}`;

// Setup logging
log.setAppName(APP_NAME);
log.setOptions({
  firebaseLogLevel: _config.logLevel || 50,
  firebasePath: FB_LOG_PATH,
});
log.startWSS();
log.appStart();

/**
 * Init
 */
function init() {
  _fb = new Firebase(`https://${Keys.firebase.appId}.firebaseio.com/`);
  _fb.authWithCustomToken(Keys.firebase.key, function(error, authToken) {
    if (error) {
      log.exception(APP_NAME, 'Firebase auth failed.', error);
    } else {
      log.log(APP_NAME, 'Firebase auth success.');
    }
  });
  log.setFirebaseRef(_fb);
  _deviceMonitor = new DeviceMonitor(_fb.child('devices'), APP_NAME);
  _deviceMonitor.on('restart_request', () => {
    _close();
    _deviceMonitor.restart('FB', 'restart_request', false);
  });
  _deviceMonitor.on('shutdown', () => {
    _close();
    _deviceMonitor.shutdown('FB', 'shutdown_request', 0);
  });

  // Load GPIO
  if (_loadGPIO() !== true) {
    _close();
    _deviceMonitor.shutdown(APP_NAME, 'GPIO unavailable', 1);
    return;
  }

  // Connect to the web socket server
  if (_config.wsServer) {
    _wsClient = new WSClient(_config.wsServer, true);
  }

  // Initialize the GCM client
  if (_config.disableGCM !== true) {
    _gcmPush = new GCMPush(_fb);
  }

  // Register listeners on each pin
  _config.pins.forEach(_registerPin);

  // Listen for changes to config
  _fb.child(`config/${APP_NAME}/pins`).on('value', (snapshot) => {
    if (_hasReadFBConfig === false) {
      _hasReadFBConfig = true;
      return;
    }
    const config = JSON.stringify(snapshot.val(), null, 2);
    fs.writeFileSync('config.json', config, {encoding: 'utf8'});
    log.log(APP_NAME, 'Config updated, restart required.');
    _close();
    _deviceMonitor.restart(APP_NAME, 'Config changed', false);
  });

  // Listen for changes to disabled
  _fb.child(`config/${APP_NAME}/disabled`).on('value', function(snapshot) {
    _config.disabled = snapshot.val();
    log.log(APP_NAME, `'disabled' changed to '${_config.disabled}'`);
  });

  // Listen for changes to log level
  _fb.child(`config/${APP_NAME}/logLevel`).on('value', (snapshot) => {
    const logLevel = snapshot.val();
    log.setOptions({
      firebaseLogLevel: logLevel || 50,
      firebasePath: FB_LOG_PATH,
    });
    log.log(APP_NAME, `Log level changed to ${logLevel}`);
  });

  // Clean up logs every 24 hours
  setInterval(function() {
    log.cleanFile();
    log.cleanLogs(FB_LOG_PATH, 7);
  }, 60 * 60 * 24 * 1000);
}

/**
 * Loads the GPIO components
 *
 * @return {Boolean} true if loaded, false if not.
 */
function _loadGPIO() {
  try {
    GPIO = require('onoff').Gpio;
    return true;
  } catch (ex) {
    log.exception(APP_NAME, `Node module 'onoff' is not available.`, ex);
    return false;
  }
}

/**
 * Event handler to register a pin.
 *
 * @param {Object} details Pin information details
 * @return {Boolean} true if successfully registered pin
 */
function _registerPin(details) {
  const pinNumber = details.pinNumber;
  if (!pinNumber) {
    log.error(APP_NAME, `Invalid pin number`, details);
    return false;
  }
  if (details.disabled) {
    log.log(APP_NAME, `Pin '${pinNumber}' disabled`);
    return false;
  }
  const edge = details.edge || 'both';
  if (!EDGES.includes(edge)) {
    log.error(APP_NAME, `Invalid edge (${edge}) for pin ${pinNumber}`);
    return false;
  }
  log.log(APP_NAME, `Listening on pin ${pinNumber} on edge: ${edge}`);
  details.lastPushed = 0;
  const pin = new GPIO(pinNumber, 'in', edge);
  if (details.invert) {
    log.debug(APP_NAME, `Inverting value on pin ${pinNumber}`);
    pin.setActiveLow(true);
  }
  const value = pin.readSync();
  details.lastValue = value;
  log.debug(APP_NAME, `Pin ${pinNumber} is currently: ${value}`);
  pin.watch((err, val) => {
    _pinChanged(details, err, val);
  });
  return true;
}

/**
 * Event handler for pin changed.
 *
 * @param {Object} pin Pin details
 * @param {Object} err Error object
 * @param {Number} value New value
 */
function _pinChanged(pin, err, value) {
  if (err) {
    const msg = `Error on pin changed for pin ${pin.pinNumber}`;
    log.error(APP_NAME, msg, err);
    return;
  }
  const now = Date.now();
  const debounceDelay = pin.debounceDelay || 250;
  const hasChanged = value !== pin.lastValue;
  const msSinceLastPush = now - pin.lastPushed;
  const timeOK = msSinceLastPush > debounceDelay;
  const msg = `pinNumber: ${pin.pinNumber} - ` +
              `value: ${value} | ` +
              `hasChanged: ${hasChanged}, ` +
              `timeOK: ${timeOK} -|- ` +
              `debounceDelay: ${debounceDelay}, ` +
              `msSinceLastPushed: ${msSinceLastPush}`;
  log.debug(APP_NAME, msg);
  pin.lastValue = value;
  if (hasChanged && timeOK) {
    pin.lastPushed = now;
    log.debug(APP_NAME, `Pin '${pin.pinNumber}' changed to '${value}'`);
    let command;
    let message;
    if (value === 1) {
      command = pin.cmdTrue;
      message = pin.msgTrue;
    } else if (value === 0) {
      command = pin.cmdFalse;
      message = pin.msgFalse;
    }
    if (_config.disabled === true) {
      log.warn(APP_NAME, `Command not sent, ${APP_NAME} is disabled`);
      return;
    }
    if (command && _wsClient) {
      _wsClient.send(JSON.stringify(command)).catch((err) => {
        log.error(APP_NAME, `Unable to send command`, err);
        log.debug(APP_NAME, `Command sent`, command);
      });
    }
    if (message && _gcmPush) {
      _gcmPush.sendMessage(message).catch((err) => {
        log.error(APP_NAME, `Unable to send message`, err);
        log.debug(APP_NAME, `Message sent`, message);
      });
    }
  }
}

/**
 * Exit the app.
*/
function _close() {
  log.log(APP_NAME, 'Preparing to exit, closing all connections...');
  // if (GPIO) {
  //   log.debug(APP_NAME, 'Unwatching pins');
  //   GPIO.unwatchAll();
  //   log.debug(APP_NAME, 'Unexporting GPIO');
  //   GPIO.unexport();
  // }
  if (_wsClient) {
    _wsClient.shutdown();
  }
}

process.on('SIGINT', function() {
  log.log(APP_NAME, 'SigInt received, shutting down...');
  _close();
  _deviceMonitor.shutdown('SIGINT', 'shutdown_request', 0);
});

init();
