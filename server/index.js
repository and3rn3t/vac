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
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// Global state
let roombaClient = null;
const wsClients = new Set();
const DEFAULT_DISCOVERY_TIMEOUT = parseInt(process.env.DISCOVERY_TIMEOUT_MS || '5000', 10);
const DEFAULT_ANALYTICS_RANGE_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_ANALYTICS_RANGE_MS = 365 * 24 * 60 * 60 * 1000;

let analyticsStore = null;
try {
  analyticsStore = new AnalyticsStore({ dbPath: process.env.ANALYTICS_DB_PATH });
  log('info', 'Analytics store initialized');
} catch (error) {
  analyticsStore = null;
  log('error', 'Failed to initialize analytics store:', error.message);
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
app.post('/api/connect', async (req, res) => {
  try {
    const { ip, blid, password } = req.body;
    
    if (!ip || !blid || !password) {
      return res.status(400).json({ error: 'Missing required fields: ip, blid, password' });
    }

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
    res.status(500).json({ error: error.message });
  }
});

// Disconnect from Roomba
app.post('/api/disconnect', (req, res) => {
  if (roombaClient) {
    roombaClient.disconnect();
    res.json({ success: true, message: 'Disconnected from Roomba' });
  } else {
    res.status(400).json({ error: 'Not connected' });
  }
});

// Get current state
app.get('/api/state', (req, res) => {
  if (roombaClient) {
    res.json(roombaClient.getState());
  } else {
    res.status(400).json({ error: 'Not connected to Roomba' });
  }
});

// Map snapshot for the most recent or active mission
app.get('/api/map', (req, res) => {
  if (!analyticsStore) {
    return res.status(503).json({ error: 'Analytics store unavailable' });
  }

  const missionIdRaw = typeof req.query.missionId === 'string' ? req.query.missionId.trim() : null;
  const missionId = missionIdRaw || currentMissionIdentifier();

  const maxPointsRaw = req.query.maxPoints ?? req.query.maxSamples;
  let maxPoints;
  if (maxPointsRaw !== undefined) {
    const parsed = parseInt(maxPointsRaw, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return res.status(400).json({ error: 'Invalid maxPoints value' });
    }
    maxPoints = parsed;
  }

  try {
    const mapData = analyticsStore.getMissionMap({ missionId, maxPoints });
    if (!mapData) {
      return res.status(404).json({ error: 'No mission map data available' });
    }
    return res.json(mapData);
  } catch (error) {
    log('error', 'Failed to compute mission map:', error.message);
    return res.status(500).json({ error: 'Failed to compute mission map' });
  }
});

// Analytics summary
app.get('/api/analytics/summary', (req, res) => {
  if (!analyticsStore) {
    return res.status(503).json({ error: 'Analytics store unavailable' });
  }

  const rangeMsRaw = req.query.range ?? req.query.rangeMs;
  const rangeMs = Math.min(
    parseDurationToMs(rangeMsRaw, DEFAULT_ANALYTICS_RANGE_MS),
    MAX_ANALYTICS_RANGE_MS
  );

  if (!Number.isFinite(rangeMs) || rangeMs <= 0) {
    return res.status(400).json({ error: 'Invalid range value' });
  }

  try {
    const summary = analyticsStore.getSummary({ rangeMs });
    res.json(summary);
  } catch (error) {
    log('error', 'Failed to compute analytics summary:', error.message);
    res.status(500).json({ error: 'Failed to compute analytics summary' });
  }
});

// Analytics history buckets
app.get('/api/analytics/history', (req, res) => {
  if (!analyticsStore) {
    return res.status(503).json({ error: 'Analytics store unavailable' });
  }

  const rangeMsRaw = req.query.range ?? req.query.rangeMs;
  const computedRangeMs = parseDurationToMs(rangeMsRaw, DEFAULT_ANALYTICS_RANGE_MS);
  const rangeMs = Math.min(
    Number.isFinite(computedRangeMs) && computedRangeMs > 0 ? computedRangeMs : DEFAULT_ANALYTICS_RANGE_MS,
    MAX_ANALYTICS_RANGE_MS
  );

  const bucketRaw = req.query.bucket ?? req.query.bucketMs;
  const bucketSizeMs = bucketRaw ? parseDurationToMs(bucketRaw, null) : undefined;
  if (bucketSizeMs !== undefined && (bucketSizeMs === null || !Number.isFinite(bucketSizeMs) || bucketSizeMs <= 0)) {
    return res.status(400).json({ error: 'Invalid bucket value' });
  }

  try {
    const history = analyticsStore.getHistory({
      rangeMs,
      bucketSizeMs: bucketSizeMs || undefined
    });
    res.json(history);
  } catch (error) {
    log('error', 'Failed to compute analytics history:', error.message);
    res.status(500).json({ error: 'Failed to compute analytics history' });
  }
});

// Start cleaning
app.post('/api/start', async (req, res) => {
  try {
    if (!roombaClient || !roombaClient.connected) {
      return res.status(400).json({ error: 'Not connected to Roomba' });
    }
    await roombaClient.start();
    res.json({ success: true, message: 'Cleaning started' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Stop cleaning
app.post('/api/stop', async (req, res) => {
  try {
    if (!roombaClient || !roombaClient.connected) {
      return res.status(400).json({ error: 'Not connected to Roomba' });
    }
    await roombaClient.stop();
    res.json({ success: true, message: 'Cleaning stopped' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Pause cleaning
app.post('/api/pause', async (req, res) => {
  try {
    if (!roombaClient || !roombaClient.connected) {
      return res.status(400).json({ error: 'Not connected to Roomba' });
    }
    await roombaClient.pause();
    res.json({ success: true, message: 'Cleaning paused' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Resume cleaning
app.post('/api/resume', async (req, res) => {
  try {
    if (!roombaClient || !roombaClient.connected) {
      return res.status(400).json({ error: 'Not connected to Roomba' });
    }
    await roombaClient.resume();
    res.json({ success: true, message: 'Cleaning resumed' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Dock (return home)
app.post('/api/dock', async (req, res) => {
  try {
    if (!roombaClient || !roombaClient.connected) {
      return res.status(400).json({ error: 'Not connected to Roomba' });
    }
    await roombaClient.dock();
    res.json({ success: true, message: 'Returning to dock' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  log('info', `🤖 Roomba Local Control Server running on port ${PORT}`);
  log('info', `📱 Web interface: http://localhost:${PORT}`);
  log('info', `🔌 WebSocket: ws://localhost:${PORT}`);
  
  // Initialize Roomba connection
  initializeRoomba();
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
