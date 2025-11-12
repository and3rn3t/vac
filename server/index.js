/**
 * Main server for Roomba local control
 * Provides REST API and WebSocket for real-time updates
 */

const express = require('express');
const cors = require('cors');
const WebSocket = require('ws');
const http = require('http');
const path = require('path');
require('dotenv').config();

const RoombaClient = require('./roomba-client');
const RoombaDiscovery = require('./discovery');
const AnalyticsStore = require('./data/analytics-store');
const deriveMissionIdentifier = AnalyticsStore.deriveMissionIdentifier;
const Scheduler = require('./scheduler');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const LOG_LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const configuredLogLevel = (process.env.LOG_LEVEL || 'info').toLowerCase();
const activeLogLevel = LOG_LEVELS[configuredLogLevel] ?? LOG_LEVELS.info;

function log(level, ...args) {
  const normalizedLevel = level.toLowerCase();
  const threshold = LOG_LEVELS[normalizedLevel];
  if (threshold === undefined || threshold > activeLogLevel) {
    return;
  }

  if (normalizedLevel === 'debug') {
    console.log(...args);
    return;
  }

  console[normalizedLevel](...args);
}

// Middleware
app.use(cors());
// Always assign a request id and echo it; clients may provide x-request-id
app.use((req, res, next) => {
  const reqId = req.headers['x-request-id'] || Math.random().toString(16).slice(2);
  req.requestId = reqId;
  res.setHeader('x-request-id', reqId);
  next();
});
// Lightweight request logging (respects LOG_LEVEL)
app.use((req, res, next) => {
  if (activeLogLevel < LOG_LEVELS.info) return next();
  const start = Date.now();
  const bodyLength = req.headers['content-length'] ? parseInt(req.headers['content-length'], 10) : undefined;
  res.on('finish', () => {
    const duration = Date.now() - start;
    const error = res.statusCode >= 400;
    log('info', `${req.requestId} ${req.method} ${req.originalUrl} -> ${res.statusCode} ${duration}ms` + (bodyLength ? ` body=${bodyLength}` : '') + (error ? ' error=true' : ''));
  });
  next();
});
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// Global state
let roombaClient = null;
const wsClients = new Set();
const DEFAULT_DISCOVERY_TIMEOUT = parseInt(process.env.DISCOVERY_TIMEOUT_MS || '5000', 10);
const DEFAULT_ANALYTICS_RANGE_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_ANALYTICS_RANGE_MS = 365 * 24 * 60 * 60 * 1000;

// Command audit trail (in-memory ring buffer)
const COMMAND_AUDIT_MAX = 200;
const commandAudit = [];
function addAudit(entry) {
  commandAudit.push({ ...entry, timestamp: entry.timestamp || Date.now() });
  if (commandAudit.length > COMMAND_AUDIT_MAX) {
    commandAudit.splice(0, commandAudit.length - COMMAND_AUDIT_MAX);
  }
}

let analyticsStore = null;
try {
  analyticsStore = new AnalyticsStore({ dbPath: process.env.ANALYTICS_DB_PATH });
  log('info', 'Analytics store initialized');
} catch (error) {
  analyticsStore = null;
  log('error', 'Failed to initialize analytics store:', error.message);
}

// Scheduler setup
let scheduler = null;
function initScheduler() {
  const storagePath = path.join(__dirname, '..', 'var', 'schedules.json');
  scheduler = new Scheduler({
    storagePath,
    broadcast,
    addAudit,
    log,
    execute: async (schedule, execReqId) => {
      // Map actions to existing endpoints/roomba commands
      if (!roombaClient || !roombaClient.connected) {
        throw new Error('Not connected to Roomba');
      }
      switch (schedule.action) {
        case 'start':
          await roombaClient.start();
          broadcast({ type: 'command', command: 'start', requestId: execReqId });
          break;
        case 'stop':
          await roombaClient.stop();
          broadcast({ type: 'command', command: 'stop', requestId: execReqId });
          break;
        case 'pause':
          await roombaClient.pause();
          broadcast({ type: 'command', command: 'pause', requestId: execReqId });
          break;
        case 'resume':
          await roombaClient.resume();
          broadcast({ type: 'command', command: 'resume', requestId: execReqId });
          break;
        case 'dock':
          await roombaClient.dock();
          broadcast({ type: 'command', command: 'dock', requestId: execReqId });
          break;
        case 'cleanRooms': {
          const payload = schedule.payload || {};
          // Basic validation: require regions array
          if (!Array.isArray(payload.regions) || payload.regions.length === 0) {
            throw new Error('cleanRooms requires regions array');
          }
          await roombaClient.cleanRooms({
            regions: payload.regions,
            ordered: payload.ordered !== undefined ? !!payload.ordered : true,
            mapId: payload.mapId || payload.pmapId,
            userPmapvId: payload.userPmapvId
          });
          broadcast({ type: 'command', command: 'cleanRooms', requestId: execReqId, payload: { regions: payload.regions, ordered: payload.ordered !== undefined ? !!payload.ordered : true } });
          break;
        }
        default:
          throw new Error(`Unknown action: ${schedule.action}`);
      }
    }
  });
}

function handleStateUpdate(state) {
  broadcast({ type: 'stateUpdate', data: state });
  if (analyticsStore) {
    try {
      analyticsStore.recordTelemetry(state);
    } catch (error) {
      log('error', 'Analytics capture failed:', error.message);
    }
  }
}

function attachRoombaEventHandlers(client) {
  client.on('stateUpdate', handleStateUpdate);

  client.on('connected', () => {
    broadcast({ type: 'connectionStatus', connected: true });
  });

  client.on('disconnected', () => {
    broadcast({ type: 'connectionStatus', connected: false });
  });

  client.on('error', (error) => {
    broadcast({ type: 'error', message: error.message });
  });
}

function parseDurationToMs(input, fallbackMs) {
  const raw = Array.isArray(input) ? input[0] : input;
  if (raw === undefined || raw === null || raw === '') {
    return fallbackMs;
  }

  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return raw;
  }

  const str = String(raw).trim();
  if (!str) {
    return fallbackMs;
  }

  if (/^\d+$/.test(str)) {
    return parseInt(str, 10);
  }

  const match = str.match(/^([0-9]+)(ms|s|m|h|d|w)$/i);
  if (!match) {
    return fallbackMs;
  }

  const value = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();
  const factors = {
    ms: 1,
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
    w: 7 * 24 * 60 * 60 * 1000
  };

  const result = value * (factors[unit] || 0);
  if (!Number.isFinite(result) || result <= 0) {
    return fallbackMs;
  }
  return result;
}

function currentMissionIdentifier() {
  if (!roombaClient) {
    return null;
  }

  try {
    const state = roombaClient.getState();
    return deriveMissionIdentifier ? deriveMissionIdentifier(state.mission) : null;
  } catch (error) {
    if (process.env.LOG_LEVEL && process.env.LOG_LEVEL.toLowerCase() === 'debug') {
      log('debug', 'Failed to derive mission identifier:', error.message);
    }
    return null;
  }
}

// Initialize Roomba client if credentials are provided
function initializeRoomba() {
  const config = {
    ip: process.env.ROOMBA_IP,
    blid: process.env.ROOMBA_BLID,
    password: process.env.ROOMBA_PASSWORD,
    port: parseInt(process.env.MQTT_PORT || '8883'),
    useTLS: process.env.MQTT_USE_TLS !== 'false',
    keepalive: parseInt(process.env.MQTT_KEEPALIVE_SEC || '60', 10),
    reconnectPeriod: parseInt(process.env.MQTT_RECONNECT_MS || '5000', 10)
  };

  if (config.ip && config.blid && config.password) {
    roombaClient = new RoombaClient(config);
    attachRoombaEventHandlers(roombaClient);

    // Auto-connect
    roombaClient.connect().catch(err => {
      log('error', 'Failed to connect to Roomba:', err.message);
    });
  } else {
    log('warn', 'Roomba credentials not configured. Use /api/connect to connect manually.');
  }
}

// Broadcast to all WebSocket clients
function broadcast(data) {
  const message = JSON.stringify(data);
  wsClients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

// WebSocket connection handler
wss.on('connection', (ws) => {
  log('info', 'New WebSocket client connected');
  wsClients.add(ws);

  // Send current state to new client
  if (roombaClient) {
    ws.send(JSON.stringify({
      type: 'stateUpdate',
      data: roombaClient.getState()
    }));
  }

  ws.on('close', () => {
    log('info', 'WebSocket client disconnected');
    wsClients.delete(ws);
  });

  ws.on('error', (error) => {
    log('error', 'WebSocket error:', error);
    wsClients.delete(ws);
  });
});

// API Routes
// Server/runtime configuration (no secrets)
app.get('/api/config', (req, res) => {
  const analyticsEnabled = !!analyticsStore;
  const retentionDays = parseInt(process.env.ANALYTICS_RETENTION_DAYS || '90', 10);
  const config = {
    analyticsEnabled,
    retentionDays: Number.isFinite(retentionDays) ? retentionDays : null,
    logLevel: configuredLogLevel,
    mqtt: {
      port: parseInt(process.env.MQTT_PORT || '8883', 10),
      useTLS: process.env.MQTT_USE_TLS !== 'false',
      keepaliveSec: parseInt(process.env.MQTT_KEEPALIVE_SEC || '60', 10),
      reconnectMs: parseInt(process.env.MQTT_RECONNECT_MS || '5000', 10)
    },
    discovery: {
      defaultTimeoutMs: DEFAULT_DISCOVERY_TIMEOUT
    },
    analytics: {
      defaultRangeMs: DEFAULT_ANALYTICS_RANGE_MS,
      maxRangeMs: MAX_ANALYTICS_RANGE_MS
    },
    version: require('../package.json').version
  };
  res.json(config);
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

// Discovery - Find Roombas on network
app.get('/api/discover', async (req, res) => {
  try {
    const discovery = new RoombaDiscovery();
    const requestedTimeout = req.query.timeoutMs ?? req.query.timeout;
    const timeoutValue = requestedTimeout ? parseInt(requestedTimeout, 10) : NaN;
    const timeout = Number.isFinite(timeoutValue) ? timeoutValue : DEFAULT_DISCOVERY_TIMEOUT;
    log('debug', `Discovery requested with timeout ${timeout}ms`);
    const robots = await discovery.discover(timeout);
    res.json({ robots });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Connect to Roomba
const {
  validateConnectBody,
  validateCleanRoomsBody,
  validateMapQuery,
  validateAnalyticsQuery,
  sendError
} = require('./validation');

app.post('/api/connect', async (req, res) => {
  try {
    const validation = validateConnectBody(req.body || {});
    if (!validation.ok) {
    return sendError(res, 400, validation.errors.join(', '), 'bad_request', req.requestId);
    }

    const { ip, blid, password } = req.body;

    // Disconnect existing client
    if (roombaClient) {
      roombaClient.disconnect();
    }

    // Create new client
    roombaClient = new RoombaClient({
      ip,
      blid,
      password,
      port: parseInt(process.env.MQTT_PORT || '8883', 10),
      useTLS: process.env.MQTT_USE_TLS !== 'false',
      keepalive: parseInt(process.env.MQTT_KEEPALIVE_SEC || '60', 10),
      reconnectPeriod: parseInt(process.env.MQTT_RECONNECT_MS || '5000', 10)
    });

    attachRoombaEventHandlers(roombaClient);

    await roombaClient.connect();
    
    res.json({ success: true, message: 'Connected to Roomba' });
  } catch (error) {
  return sendError(res, 500, error.message, 'connect_failed', req.requestId);
  }
});

// Disconnect from Roomba
app.post('/api/disconnect', (req, res) => {
  if (roombaClient) {
    roombaClient.disconnect();
    res.json({ success: true, message: 'Disconnected from Roomba' });
  } else {
  return sendError(res, 400, 'Not connected', 'not_connected', req.requestId);
  }
});

// Get current state
app.get('/api/state', (req, res) => {
  if (roombaClient) {
    res.json(roombaClient.getState());
  } else {
  return sendError(res, 400, 'Not connected to Roomba', 'not_connected', req.requestId);
  }
});

// Map snapshot for the most recent or active mission
app.get('/api/map', (req, res) => {
  if (!analyticsStore) {
  return sendError(res, 503, 'Analytics store unavailable', 'unavailable', req.requestId);
  }

  const v = validateMapQuery(req.query || {});
  if (!v.ok) {
    return sendError(res, 400, v.errors.join(', '), 'bad_request', req.requestId);
  }
  const missionId = v.missionId || currentMissionIdentifier();
  const maxPoints = v.maxPoints;

  try {
    const mapData = analyticsStore.getMissionMap({ missionId, maxPoints });
    if (!mapData) {
  return sendError(res, 404, 'No mission map data available', 'not_found', req.requestId);
    }
    return res.json(mapData);
  } catch (error) {
    log('error', 'Failed to compute mission map:', error.message);
  return sendError(res, 500, 'Failed to compute mission map', 'internal_error', req.requestId);
  }
});

// Analytics summary
app.get('/api/analytics/summary', (req, res) => {
  if (!analyticsStore) {
  return sendError(res, 503, 'Analytics store unavailable', 'unavailable', req.requestId);
  }

  const v = validateAnalyticsQuery(req.query || {}, { defaultRangeMs: DEFAULT_ANALYTICS_RANGE_MS });
  if (!v.ok) {
    return sendError(res, 400, v.errors.join(', '), 'bad_request', req.requestId);
  }
  const rangeMs = Math.min(v.rangeMs, MAX_ANALYTICS_RANGE_MS);

  try {
    const summary = analyticsStore.getSummary({ rangeMs });
    res.json(summary);
  } catch (error) {
    log('error', 'Failed to compute analytics summary:', error.message);
  return sendError(res, 500, 'Failed to compute analytics summary', 'internal_error', req.requestId);
  }
});

// Analytics history buckets
app.get('/api/analytics/history', (req, res) => {
  if (!analyticsStore) {
  return sendError(res, 503, 'Analytics store unavailable', 'unavailable', req.requestId);
  }

  const v = validateAnalyticsQuery(req.query || {}, { defaultRangeMs: DEFAULT_ANALYTICS_RANGE_MS });
  if (!v.ok) {
    return sendError(res, 400, v.errors.join(', '), 'bad_request', req.requestId);
  }
  const rangeMs = Math.min(v.rangeMs, MAX_ANALYTICS_RANGE_MS);
  const bucketSizeMs = v.bucketSizeMs;

  try {
    const history = analyticsStore.getHistory({
      rangeMs,
      bucketSizeMs: bucketSizeMs || undefined
    });
    res.json(history);
  } catch (error) {
    log('error', 'Failed to compute analytics history:', error.message);
  return sendError(res, 500, 'Failed to compute analytics history', 'internal_error', req.requestId);
  }
});

// Targeted room cleaning
app.post('/api/cleanRooms', async (req, res) => {
  try {
    if (!roombaClient || !roombaClient.connected) {
      broadcast({ type: 'error', command: 'cleanRooms', requestId: req.requestId, message: 'Not connected to Roomba' });
      addAudit({ requestId: req.requestId, command: 'cleanRooms', status: 'error', message: 'Not connected to Roomba' });
      return sendError(res, 400, 'Not connected to Roomba', 'not_connected', req.requestId);
    }
    const body = req.body || {};
    const v = validateCleanRoomsBody(body);
    if (!v.ok) {
      log('warn', 'Targeted clean request rejected:', v.errors.join(', '));
      broadcast({ type: 'error', command: 'cleanRooms', requestId: req.requestId, message: v.errors.join(', ') });
      addAudit({ requestId: req.requestId, command: 'cleanRooms', status: 'error', message: v.errors.join(', ') });
      return sendError(res, 400, v.errors.join(', '), 'bad_request', req.requestId);
    }

    const options = {
      regions: v.regions,
      ordered: body.ordered !== undefined ? !!body.ordered : true
    };

    if (body.mapId || body.pmapId) {
      options.mapId = body.mapId || body.pmapId;
    }

    if (body.userPmapvId) {
      options.userPmapvId = body.userPmapvId;
    }

    log('info', 'Targeted clean request received', {
      regionCount: v.regions.length,
      ordered: options.ordered,
      explicitMapId: options.mapId ? true : false
    });

    await roombaClient.cleanRooms(options);

    log('info', 'Targeted clean command dispatched', {
      regionIds: v.regions.map((entry) => (typeof entry === 'object' && entry !== null
        ? entry.region_id || entry.regionId || entry.id
        : entry)),
      ordered: options.ordered
    });

    const payload = {
      success: true,
      message: 'Targeted clean started',
      regions: v.regions,
      requestId: req.requestId
    };
    res.json(payload);
    broadcast({ type: 'command', command: 'cleanRooms', requestId: req.requestId, payload: { regions: v.regions, ordered: options.ordered } });
    addAudit({ requestId: req.requestId, command: 'cleanRooms', status: 'ok', payload: { regions: v.regions, ordered: options.ordered } });
  } catch (error) {
    log('error', 'Targeted clean failed:', error.message);
    broadcast({ type: 'error', command: 'cleanRooms', requestId: req.requestId, message: error.message });
    addAudit({ requestId: req.requestId, command: 'cleanRooms', status: 'error', message: error.message });
    return sendError(res, 500, error.message, 'command_failed', req.requestId);
  }
});

// Start cleaning
app.post('/api/start', async (req, res) => {
  try {
    if (!roombaClient || !roombaClient.connected) {
      broadcast({ type: 'error', command: 'start', requestId: req.requestId, message: 'Not connected to Roomba' });
      addAudit({ requestId: req.requestId, command: 'start', status: 'error', message: 'Not connected to Roomba' });
      return sendError(res, 400, 'Not connected to Roomba', 'not_connected', req.requestId);
    }
    await roombaClient.start();
    res.json({ success: true, message: 'Cleaning started', requestId: req.requestId });
    broadcast({ type: 'command', command: 'start', requestId: req.requestId });
    addAudit({ requestId: req.requestId, command: 'start', status: 'ok' });
  } catch (error) {
    broadcast({ type: 'error', command: 'start', requestId: req.requestId, message: error.message });
    addAudit({ requestId: req.requestId, command: 'start', status: 'error', message: error.message });
    return sendError(res, 500, error.message, 'command_failed', req.requestId);
  }
});

// Stop cleaning
app.post('/api/stop', async (req, res) => {
  try {
    if (!roombaClient || !roombaClient.connected) {
      broadcast({ type: 'error', command: 'stop', requestId: req.requestId, message: 'Not connected to Roomba' });
      addAudit({ requestId: req.requestId, command: 'stop', status: 'error', message: 'Not connected to Roomba' });
      return sendError(res, 400, 'Not connected to Roomba', 'not_connected', req.requestId);
    }
    await roombaClient.stop();
    res.json({ success: true, message: 'Cleaning stopped', requestId: req.requestId });
    broadcast({ type: 'command', command: 'stop', requestId: req.requestId });
    addAudit({ requestId: req.requestId, command: 'stop', status: 'ok' });
  } catch (error) {
    broadcast({ type: 'error', command: 'stop', requestId: req.requestId, message: error.message });
    addAudit({ requestId: req.requestId, command: 'stop', status: 'error', message: error.message });
    return sendError(res, 500, error.message, 'command_failed', req.requestId);
  }
});

// Pause cleaning
app.post('/api/pause', async (req, res) => {
  try {
    if (!roombaClient || !roombaClient.connected) {
      broadcast({ type: 'error', command: 'pause', requestId: req.requestId, message: 'Not connected to Roomba' });
      addAudit({ requestId: req.requestId, command: 'pause', status: 'error', message: 'Not connected to Roomba' });
      return sendError(res, 400, 'Not connected to Roomba', 'not_connected', req.requestId);
    }
    await roombaClient.pause();
    res.json({ success: true, message: 'Cleaning paused', requestId: req.requestId });
    broadcast({ type: 'command', command: 'pause', requestId: req.requestId });
    addAudit({ requestId: req.requestId, command: 'pause', status: 'ok' });
  } catch (error) {
    broadcast({ type: 'error', command: 'pause', requestId: req.requestId, message: error.message });
    addAudit({ requestId: req.requestId, command: 'pause', status: 'error', message: error.message });
    return sendError(res, 500, error.message, 'command_failed', req.requestId);
  }
});

// Resume cleaning
app.post('/api/resume', async (req, res) => {
  try {
    if (!roombaClient || !roombaClient.connected) {
      broadcast({ type: 'error', command: 'resume', requestId: req.requestId, message: 'Not connected to Roomba' });
      addAudit({ requestId: req.requestId, command: 'resume', status: 'error', message: 'Not connected to Roomba' });
      return sendError(res, 400, 'Not connected to Roomba', 'not_connected', req.requestId);
    }
    await roombaClient.resume();
    res.json({ success: true, message: 'Cleaning resumed', requestId: req.requestId });
    broadcast({ type: 'command', command: 'resume', requestId: req.requestId });
    addAudit({ requestId: req.requestId, command: 'resume', status: 'ok' });
  } catch (error) {
    broadcast({ type: 'error', command: 'resume', requestId: req.requestId, message: error.message });
    addAudit({ requestId: req.requestId, command: 'resume', status: 'error', message: error.message });
    return sendError(res, 500, error.message, 'command_failed', req.requestId);
  }
});

// Dock (return home)
app.post('/api/dock', async (req, res) => {
  try {
    if (!roombaClient || !roombaClient.connected) {
      broadcast({ type: 'error', command: 'dock', requestId: req.requestId, message: 'Not connected to Roomba' });
      addAudit({ requestId: req.requestId, command: 'dock', status: 'error', message: 'Not connected to Roomba' });
      return sendError(res, 400, 'Not connected to Roomba', 'not_connected', req.requestId);
    }
    await roombaClient.dock();
    res.json({ success: true, message: 'Returning to dock', requestId: req.requestId });
    broadcast({ type: 'command', command: 'dock', requestId: req.requestId });
    addAudit({ requestId: req.requestId, command: 'dock', status: 'ok' });
  } catch (error) {
    broadcast({ type: 'error', command: 'dock', requestId: req.requestId, message: error.message });
    addAudit({ requestId: req.requestId, command: 'dock', status: 'error', message: error.message });
    return sendError(res, 500, error.message, 'command_failed', req.requestId);
  }
});

function startServer(port = process.env.PORT || 3000) {
  return new Promise((resolve, reject) => {
    server.once('error', (err) => reject(err));
    server.listen(port, () => {
      const actualPort = server.address().port;
      log('info', `🤖 Roomba Local Control Server running on port ${actualPort}`);
      log('info', `📱 Web interface: http://localhost:${actualPort}`);
      log('info', `🔌 WebSocket: ws://localhost:${actualPort}`);
      initializeRoomba();
      initScheduler();
      resolve({ port: actualPort });
    });
  });
}

// Explicit stop helper for tests / controlled shutdown
function stopServer() {
  return new Promise((resolve) => {
    try {
      if (scheduler && typeof scheduler.dispose === 'function') {
        scheduler.dispose();
      }
      if (roombaClient) {
        try { roombaClient.disconnect(); } catch (e) { /* ignore */ }
      }
      // Close WebSocket server first to prevent new connections
      try { wss.close(); } catch (e) { /* ignore */ }
      server.close(() => {
        log('info', 'Server stopped');
        resolve();
      });
    } catch (e) {
      log('error', 'Error during stopServer:', e.message);
      resolve();
    }
  });
}

// Auto-start only when executed directly (not during tests/imports)
if (require.main === module) {
  startServer().catch(err => {
    log('error', 'Failed to start server:', err.message);
  });
}

// Commands audit endpoint
const { parsePositiveInt } = require('./validation');
app.get('/api/commands', (req, res) => {
  const limit = parsePositiveInt(req.query.limit, 50) || 50;
  const items = commandAudit.slice(-limit).reverse();
  res.json({ items, total: commandAudit.length });
});

// Scheduling endpoints
function validateScheduleCreate(body) {
  const errors = [];
  const action = body?.action;
  const when = body?.when ?? body?.scheduledAt;
  const payload = body?.payload;
  const allowed = ['start', 'stop', 'pause', 'resume', 'dock', 'cleanRooms'];
  if (!allowed.includes(action)) errors.push('Invalid or missing action');
  let scheduledAt = null;
  if (typeof when === 'number' && Number.isFinite(when)) {
    scheduledAt = when;
  } else if (typeof when === 'string' && when.trim()) {
    const d = new Date(when);
    if (!isNaN(d.getTime())) scheduledAt = d.getTime();
  }
  if (!scheduledAt) errors.push('Invalid or missing scheduled time');
  let intervalMs = null;
  if (body?.intervalMs !== undefined) {
    const iv = Number(body.intervalMs);
    if (!Number.isFinite(iv) || iv <= 0) errors.push('intervalMs must be a positive number');
    else intervalMs = iv;
  }
  // Require payload for cleanRooms
  if (action === 'cleanRooms') {
    if (!payload || !Array.isArray(payload.regions) || payload.regions.length === 0) {
      errors.push('cleanRooms requires payload.regions array');
    }
  }
  return { ok: errors.length === 0, errors, action, scheduledAt, payload, intervalMs };
}

app.get('/api/schedules', (req, res) => {
  if (!scheduler) return res.json({ items: [] });
  const items = scheduler.list();
  res.json({ items });
});

app.post('/api/schedules', (req, res) => {
  try {
    if (!scheduler) initScheduler();
    const v = validateScheduleCreate(req.body || {});
    if (!v.ok) {
      return sendError(res, 400, v.errors.join(', '), 'bad_request', req.requestId);
    }
    const s = scheduler.create({ scheduledAt: v.scheduledAt, action: v.action, payload: v.payload, requestId: req.requestId });
    if (v.intervalMs) scheduler.update(s.id, { intervalMs: v.intervalMs });
    res.status(201).json({ schedule: s });
  } catch (error) {
    return sendError(res, 500, error.message, 'internal_error', req.requestId);
  }
});

app.delete('/api/schedules/:id', (req, res) => {
  if (!scheduler) return sendError(res, 404, 'Scheduler not initialized', 'not_found', req.requestId);
  const s = scheduler.cancel(req.params.id);
  if (!s) return sendError(res, 404, 'Schedule not found', 'not_found', req.requestId);
  res.json({ schedule: s });
});

// Update schedule (pending only)
app.patch('/api/schedules/:id', (req, res) => {
  if (!scheduler) return sendError(res, 404, 'Scheduler not initialized', 'not_found', req.requestId);
  const id = req.params.id;
  const body = req.body || {};
  const allowedActions = ['start', 'stop', 'pause', 'resume', 'dock', 'cleanRooms'];
  const update = {};
  if (body.when || body.scheduledAt) {
    const when = body.when ?? body.scheduledAt;
    if (typeof when === 'number' && Number.isFinite(when)) update.scheduledAt = when;
    else if (typeof when === 'string' && when.trim()) {
      const d = new Date(when);
      if (!isNaN(d.getTime())) update.scheduledAt = d.getTime();
    }
  }
  if (typeof body.action === 'string' && allowedActions.includes(body.action)) update.action = body.action;
  if (body.payload !== undefined) update.payload = body.payload || null;
  if (body.intervalMs !== undefined) {
    const iv = Number(body.intervalMs);
    update.intervalMs = Number.isFinite(iv) && iv > 0 ? iv : null;
  }
  const s = scheduler.update(id, update);
  if (!s) return sendError(res, 404, 'Schedule not found', 'not_found', req.requestId);
  res.json({ schedule: s });
});

// Graceful shutdown
process.on('SIGINT', () => {
  log('info', '\nShutting down...');
  if (roombaClient) {
    roombaClient.disconnect();
  }
  server.close(() => {
    log('info', 'Server closed');
    process.exit(0);
  });
});

module.exports = { app, startServer, stopServer };
