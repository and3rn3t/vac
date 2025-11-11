# API Documentation

This document describes the REST API and WebSocket interface for the Roomba Local Control System.

## Base URL

```
http://[server-ip]:3000/api
```

Default: `http://localhost:3000/api`

## REST API Endpoints

### Health Check

Check if the server is running.

```http
GET /api/health
```

**Response:**
```json
{
  "status": "ok",
  "timestamp": 1699876543210
}
```

---

### Discover Roombas

Scan the local network for Roomba devices (UDP broadcast on port 5678).

```http
GET /api/discover
```

**Response:**
```json
{
  "robots": [
    {
      "ip": "192.168.1.100",
      "blid": "ABCDEF1234567890",
      "name": "Roomba-j9",
      "message": "...",
      "timestamp": 1699876543210
    }
  ]
}
```

**Notes:**
- Discovery may take up to 5 seconds
- Requires UDP broadcast support on your network
- Some routers/VLANs may block broadcast traffic

---

### Connect to Roomba

Establish MQTT connection to a specific Roomba.

```http
POST /api/connect
Content-Type: application/json

{
  "ip": "192.168.1.100",
  "blid": "ABCDEF1234567890",
  "password": ":1:2345678901:AbCdEfGhIjKlMnOp"
}
```

**Response (Success):**
```json
{
  "success": true,
  "message": "Connected to Roomba"
}
```

**Response (Error):**
```json
{
  "error": "Connection timeout"
}
```

**Status Codes:**
- `200 OK` - Successfully connected
- `400 Bad Request` - Missing required fields
- `500 Internal Server Error` - Connection failed

---

### Disconnect from Roomba

Close the MQTT connection.

```http
POST /api/disconnect
```

**Response:**
```json
{
  "success": true,
  "message": "Disconnected from Roomba"
}
```

---

### Get Robot State

Retrieve the current state of the connected Roomba.

```http
GET /api/state
```

**Response:**
```json
{
  "connected": true,
  "battery": 85,
  "cleaning": false,
  "binFull": false,
  "position": {
    "x": 100,
    "y": 250,
    "theta": 45
  },
  "mission": {
    "phase": "charge",
    "mssnM": 1234,
    "sqft": 150,
    "nMssn": 42
  }
}
```

**Field Descriptions:**
- `connected`: Whether MQTT connection is active
- `battery`: Battery percentage (0-100)
- `cleaning`: Whether robot is actively cleaning
- `binFull`: Whether the dust bin is full
- `position.x`: X coordinate on map
- `position.y`: Y coordinate on map
- `position.theta`: Heading angle in degrees
- `mission.phase`: Current mission phase (run, charge, stop, etc.)
- `mission.mssnM`: Mission time in seconds
- `mission.sqft`: Area cleaned in square feet
- `mission.nMssn`: Mission number

---

### Start Cleaning

Start a cleaning mission.

```http
POST /api/start
```

**Response:**
```json
{
  "success": true,
  "message": "Cleaning started"
}
```

**Notes:**
- Robot must be connected
- Robot must not be charging or in error state

---

### Stop Cleaning

Stop the current cleaning mission and prepare to return home.

```http
POST /api/stop
```

**Response:**
```json
{
  "success": true,
  "message": "Cleaning stopped"
}
```

---

### Pause Cleaning

Pause the current cleaning mission.

```http
POST /api/pause
```

**Response:**
```json
{
  "success": true,
  "message": "Cleaning paused"
}
```

**Notes:**
- Robot will stop in place
- Use `/api/resume` to continue cleaning

---

### Resume Cleaning

Resume a paused cleaning mission.

```http
POST /api/resume
```

**Response:**
```json
{
  "success": true,
  "message": "Cleaning resumed"
}
```

---

### Return to Dock

Command robot to return to the charging dock.

```http
POST /api/dock
```

**Response:**
```json
{
  "success": true,
  "message": "Returning to dock"
}
```

---

## WebSocket API

Real-time updates are provided via WebSocket connection.

### Connection

```javascript
const ws = new WebSocket('ws://[server-ip]:3000');

ws.onopen = () => {
  console.log('Connected to Roomba server');
};

ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  handleMessage(message);
};
```

### Message Types

#### State Update

Sent periodically when robot state changes.

```json
{
  "type": "stateUpdate",
  "data": {
    "connected": true,
    "battery": 85,
    "cleaning": true,
    "binFull": false,
    "position": { "x": 100, "y": 250, "theta": 45 },
    "mission": { ... }
  }
}
```

#### Connection Status

Sent when connection to Roomba changes.

```json
{
  "type": "connectionStatus",
  "connected": true
}
```

#### Error

Sent when an error occurs.

```json
{
  "type": "error",
  "message": "Connection lost"
}
```

### Example Client

```javascript
class RoombaWebSocket {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.setupHandlers();
  }

  setupHandlers() {
    this.ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      
      switch (msg.type) {
        case 'stateUpdate':
          this.onStateUpdate(msg.data);
          break;
        case 'connectionStatus':
          this.onConnectionStatus(msg.connected);
          break;
        case 'error':
          this.onError(msg.message);
          break;
      }
    };
  }

  onStateUpdate(state) {
    console.log('Robot state:', state);
  }

  onConnectionStatus(connected) {
    console.log('Connected:', connected);
  }

  onError(message) {
    console.error('Error:', message);
  }
}

// Usage
const roomba = new RoombaWebSocket('ws://localhost:3000');
```

---

## Error Responses

All endpoints may return error responses with the following format:

```json
{
  "error": "Error message description"
}
```

Common error status codes:
- `400 Bad Request` - Invalid input or precondition not met
- `500 Internal Server Error` - Server or connection error

---

## Rate Limiting

Currently, there is no rate limiting implemented. Be mindful of:
- Sending commands too frequently (recommended: 1 command per second)
- Discovery requests (recommended: no more than once per minute)

---

## Security

### Local Network Only

This API is designed for local network use only. Do not expose it to the internet without proper authentication and encryption.

### HTTPS/WSS

To add HTTPS/WSS support:

1. Generate SSL certificates
2. Modify `server/index.js` to use `https.createServer()`
3. Update WebSocket to use `wss://`

### Authentication

Current version does not implement authentication. For multi-user environments, consider adding:
- API keys
- JWT tokens
- OAuth2

---

## Client Libraries

### JavaScript/Node.js

```javascript
const axios = require('axios');

const api = axios.create({
  baseURL: 'http://localhost:3000/api',
  timeout: 5000
});

// Connect
await api.post('/connect', {
  ip: '192.168.1.100',
  blid: 'BLID',
  password: 'PASSWORD'
});

// Start cleaning
await api.post('/start');

// Get state
const { data } = await api.get('/state');
console.log('Battery:', data.battery);
```

### Python

```python
import requests

BASE_URL = 'http://localhost:3000/api'

# Connect
response = requests.post(f'{BASE_URL}/connect', json={
    'ip': '192.168.1.100',
    'blid': 'BLID',
    'password': 'PASSWORD'
})

# Start cleaning
requests.post(f'{BASE_URL}/start')

# Get state
state = requests.get(f'{BASE_URL}/state').json()
print(f"Battery: {state['battery']}%")
```

### cURL

```bash
# Discover robots
curl http://localhost:3000/api/discover

# Connect
curl -X POST http://localhost:3000/api/connect \
  -H "Content-Type: application/json" \
  -d '{"ip":"192.168.1.100","blid":"BLID","password":"PASSWORD"}'

# Start cleaning
curl -X POST http://localhost:3000/api/start

# Get state
curl http://localhost:3000/api/state
```

---

## Future API Enhancements

Planned additions:
- Room-specific cleaning commands
- Schedule management endpoints
- Map data retrieval
- Historical mission data
- Multi-robot support
- Webhook notifications

## Support

For API questions or issues, please refer to:
- [README.md](README.md) for general usage
- [PROTOCOL.md](PROTOCOL.md) for protocol details
- GitHub issues for bug reports
