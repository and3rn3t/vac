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

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// Global state
let roombaClient = null;
const wsClients = new Set();

// Initialize Roomba client if credentials are provided
function initializeRoomba() {
  const config = {
    ip: process.env.ROOMBA_IP,
    blid: process.env.ROOMBA_BLID,
    password: process.env.ROOMBA_PASSWORD,
    port: parseInt(process.env.MQTT_PORT || '8883'),
    useTLS: process.env.MQTT_USE_TLS !== 'false'
  };

  if (config.ip && config.blid && config.password) {
    roombaClient = new RoombaClient(config);

    // Forward events to WebSocket clients
    roombaClient.on('stateUpdate', (state) => {
      broadcast({ type: 'stateUpdate', data: state });
    });

    roombaClient.on('connected', () => {
      broadcast({ type: 'connectionStatus', connected: true });
    });

    roombaClient.on('disconnected', () => {
      broadcast({ type: 'connectionStatus', connected: false });
    });

    roombaClient.on('error', (error) => {
      broadcast({ type: 'error', message: error.message });
    });

    // Auto-connect
    roombaClient.connect().catch(err => {
      console.error('Failed to connect to Roomba:', err.message);
    });
  } else {
    console.warn('Roomba credentials not configured. Use /api/connect to connect manually.');
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
  console.log('New WebSocket client connected');
  wsClients.add(ws);

  // Send current state to new client
  if (roombaClient) {
    ws.send(JSON.stringify({
      type: 'stateUpdate',
      data: roombaClient.getState()
    }));
  }

  ws.on('close', () => {
    console.log('WebSocket client disconnected');
    wsClients.delete(ws);
  });

  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
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
    const robots = await discovery.discover(5000);
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
    roombaClient = new RoombaClient({ ip, blid, password });
    
    // Set up event handlers
    roombaClient.on('stateUpdate', (state) => {
      broadcast({ type: 'stateUpdate', data: state });
    });

    roombaClient.on('connected', () => {
      broadcast({ type: 'connectionStatus', connected: true });
    });

    roombaClient.on('disconnected', () => {
      broadcast({ type: 'connectionStatus', connected: false });
    });

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
  console.log(`🤖 Roomba Local Control Server running on port ${PORT}`);
  console.log(`📱 Web interface: http://localhost:${PORT}`);
  console.log(`🔌 WebSocket: ws://localhost:${PORT}`);
  
  // Initialize Roomba connection
  initializeRoomba();
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down...');
  if (roombaClient) {
    roombaClient.disconnect();
  }
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});
