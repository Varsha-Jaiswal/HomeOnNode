'use strict';

const express = require('express');
const path = require('path');
const log = require('./SystemLog2');
const methodOverride = require('method-override');
const bodyParser = require('body-parser');

const LOG_PREFIX = 'HTTPRequest';

/**
 * Starts the local HTTP server.
 * @constructor
 *
 * @param {Object} config The config object for the server.
 * @param {Home} home An instance of the Home controller.
*/
function HTTPServer(config, home) {
  let server;

  this.shutdown = function() {
    if (server) {
      server.close();
      return true;
    } else {
      return false;
    }
  };

  const exp = express();

  log.init(LOG_PREFIX, 'Starting...');
  const port = config.httpServerPort || 3000;
  exp.set('port', port);
  exp.use(methodOverride());
  exp.use(bodyParser.json());
  exp.use(bodyParser.urlencoded({extended: true}));
  exp.use(bodyParser.text());

  exp.use(function(req, res, next) {
    const msg = req.method + ' ' + req.path + ' from ' + req.ip;
    let body = req.body;
    if (Object.keys(body).length === 0) {
      body = null;
    }
    log.debug(LOG_PREFIX, msg, body);
    next();
  });

  exp.get('/favicon.ico', function(req, res) {
    res.sendFile(path.join(__dirname, '/web/favicon.ico'));
  });

  exp.post('/shutdown', function(req, res) {
    let body = req.body;
    if (typeof body === 'string') {
      body = JSON.parse(body);
    }
    if (body.confirmation === 'shutdown') {
      const timeout = 5000;
      home.shutdown();
      res.send({'shutdown': true, 'timeout': timeout});
      log.appStop('HTTP [' + req.ip + ']');
      setTimeout(function() {
        process.exit();
      }, timeout);
    } else {
      res.send({'shutdown': false});
      log.error(LOG_PREFIX, 'System shutdown attempted, but not confirmed.');
    }
  });

  exp.get('/state', function(req, res) {
    res.send(home.state);
  });

  exp.post('/execute/state/:state', function(req, res) {
    const state = req.params.state.toUpperCase();
    if (state === 'AWAY' || state === 'HOME' || state === 'ARMED') {
      const sender = '[HTTP ' + req.ip + ']';
      home.executeCommand({state: state}, sender);
      res.status(202);
      res.send({result: 'done'});
    } else {
      res.status(400);
      res.send({result: 'failed', error: 'unknown state'});
    }
  });

  exp.post('/execute/name', function(req, res) {
    let body = req.body;
    if (typeof body === 'string') {
      body = JSON.parse(body);
    }
    const sender = '[HTTP ' + req.ip + ']';
    home.executeCommandByName(body.cmdName, body.modifier, sender);
    res.send({result: 'done'});
  });

  exp.post('/execute', function(req, res) {
    let body = req.body;
    if (typeof body === 'string') {
      body = JSON.parse(body);
    }
    const sender = '[HTTP ' + req.ip + ']';
    home.executeCommand(body, sender);
    res.send({result: 'done'});
  });

  exp.post('/doorbell', function(req, res) {
    const sender = '[HTTP ' + req.ip + ']';
    home.ringDoorbell(sender);
    res.send({result: 'done'});
  });

  exp.use(function(req, res) {
    res.status(404);
    res.send({error: 'Requested URL not found.'});
    log.error(LOG_PREFIX, 'File not found: ' + req.path + ' [' + req.ip + ']');
  });

  exp.use(function(err, req, res, next) {
    res.status(err.status || 500);
    res.send({error: err.message});
    let msg = 'Server Error (' + err.status + ') for: ';
    msg += req.path + ' [' + req.ip + ']';
    log.exception(LOG_PREFIX, msg, err);
  });

  server = exp.listen(exp.get('port'), function() {
    log.log(LOG_PREFIX, 'Express server started on port ' + exp.get('port'));
  });
}

module.exports = HTTPServer;
