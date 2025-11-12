# API Documentation

This document describes the REST API and WebSocket interface for the Roomba Local Control System.

## Base URL

```text
http://[server-ip]:3000/api
```json

Default: `http://localhost:3000/api`

Scheduler endpoints (overview):

- `GET /api/schedules` list all schedules
- `POST /api/schedules` create a one-shot or recurring schedule (`intervalMs`)
- `PATCH /api/schedules/:id` update pending schedule (time/action/payload/interval)
- `DELETE /api/schedules/:id` cancel a pending schedule

## REST API Endpoints

### Server Configuration

Retrieve non-sensitive runtime configuration values.

```http
GET /api/config
```json

**Response:**

```json
{
  "analyticsEnabled": true,
  "retentionDays": 90,
  "logLevel": "info",
  "mqtt": {
    "port": 8883,
    "useTLS": true,
    "keepaliveSec": 60,
    "reconnectMs": 5000
  },
  "discovery": { "defaultTimeoutMs": 5000 },
  "analytics": { "defaultRangeMs": 2592000000, "maxRangeMs": 31536000000 },
  "version": "1.0.0"
}
```json

Notes:

- Does not expose secrets (passwords, BLID).
- Suitable for UI feature toggling and diagnostics.

---

### Command Audit Trail

Inspect recently issued commands and their outcomes (in-memory ring buffer).

```http
GET /api/commands
GET /api/commands?limit=25
```json

**Response:**

```json
{
  "items": [
    { "timestamp": 1699900000000, "requestId": "a1b2c3d4", "command": "start", "status": "ok" },
    { "timestamp": 1699900010000, "requestId": "a1b2c3d5", "command": "dock", "status": "error", "message": "Not connected to Roomba" }
  ],
  "total": 2
}
```json

Notes:

- This buffer is ephemeral and resets on server restart.
- Use `requestId` to correlate with REST responses and WebSocket events.

---
 
### Health Check

Check if the server is running.

```http
GET /api/health
```json

**Response:**

```json
{
  "status": "ok",
  "timestamp": 1699876543210
}
```json

---

### Discover Roombas

Scan the local network for Roomba devices (UDP broadcast on port 5678).

```http
GET /api/discover
GET /api/discover?timeoutMs=10000
```json

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
```json

**Notes:**

- Default scan duration comes from `DISCOVERY_TIMEOUT_MS` in `.env` (defaults to 5000 ms)
- Override per request with the optional `timeout` or `timeoutMs` query parameter (value in milliseconds)
- Requires UDP broadcast support on your network and may be blocked on some routers/VLANs

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
```json

**Response (Success):**

```json
{
  "success": true,
  "message": "Connected to Roomba"
}
```json

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

### Get Mission Map

Retrieve a downsampled point cloud for the most recent (or specified) cleaning mission. Useful for rendering a footprint of the robot's path.

```http
GET /api/map
GET /api/map?missionId=clean:42&maxPoints=1500
```

**Query Parameters:**

- `missionId` (optional): Target a specific mission identifier. Defaults to the active mission (if connected) or the latest mission in the analytics store.
- `maxPoints` (optional): Upper bound for returned path points (defaults to 2000, capped at 5000).

**Response:**

```json
{
  "missionId": "run:42",
  "startedAt": 1699900000000,
  "endedAt": 1699903600000,
  "sampleCount": 4325,
  "pointCount": 1200,
  "bounds": {
    "minX": -260,
    "maxX": 840,
    "minY": -180,
    "maxY": 610
  },
  "mission": {
    "phase": "run",
    "cycle": "clean",
    "nMssn": 42
  },
  "mapId": "pmap123",
  "regions": [
    { "id": "kitchen", "type": "RID", "name": "Kitchen" },
    { "id": "5", "type": "SEGMENT", "name": "Segment 5" }
  ],
  "points": [
    { "timestamp": 1699900000000, "x": -12, "y": 0, "theta": 90, "segmentId": "5", "regionId": "kitchen" },
    { "timestamp": 1699900005000, "x": -6, "y": 18, "theta": 92, "segmentId": "5", "regionId": "kitchen" }
  ]
}
```

**Notes:**

- Raw telemetry samples are persisted in the local SQLite analytics database; make sure analytics is enabled.
- The `points` array is downsampled to keep payloads lightweight while preserving the overall path shape.
- `mapId` surfaces the persistent map identifier reported by the robot. `regions` lists discovered rooms/segments returned in telemetry so the UI can render overlays or targeted controls.
- When no map data is available yet, the endpoint responds with `404 Not Found`.

---

### Analytics Summary

Retrieve aggregated telemetry metrics over a selectable window.

```http
GET /api/analytics/summary
GET /api/analytics/summary?range=7d
```

**Query Parameters:**

- `range` (optional): Time window to aggregate. Accepts milliseconds or suffix units `ms`, `s`, `m`, `h`, `d`, `w` (defaults to 30 days, capped at 365 days).

**Response:**

```json
{
  "rangeMs": 604800000,
  "sampleCount": 864,
  "rangeStart": 1699200000000,
  "rangeEnd": 1699800000000,
  "cleaningSampleCount": 128,
  "estimatedCleaningMs": 5400000,
  "estimatedTotalMs": 43200000,
  "averageBatteryPct": 82.5,
  "minBatteryPct": 18,
  "maxBatteryPct": 100,
  "binFullEvents": 2,
  "missionsStarted": 6
}
```

**Notes:**

- `estimatedCleaningMs`/`estimatedTotalMs` are derived from sample deltas (large gaps are clamped to 5 minutes).
- Metrics are calculated from data stored in the local SQLite database (`ANALYTICS_DB_PATH`).

---

### Analytics History

Retrieve bucketed trend data for charts or time-series analysis.

```http
GET /api/analytics/history
GET /api/analytics/history?range=30d&bucket=1d
```

**Query Parameters:**

- `range` (optional): Time window to include (same format as summary, defaults to 30 days, capped at 365 days).
- `bucket` (optional): Bucket size for grouping. Accepts the same units as `range` (falls back to auto-selected buckets).

**Response:**

```json
{
  "rangeMs": 2592000000,
  "bucketSizeMs": 86400000,
  "rangeStart": 1697328000000,
  "rangeEnd": 1699843200000,
  "buckets": [
    {
      "start": 1699401600000,
      "end": 1699488000000,
      "sampleCount": 36,
      "cleaningSampleCount": 10,
      "estimatedCleaningMs": 720000,
      "estimatedTotalMs": 2160000,
      "averageBatteryPct": 78.25,
      "minBatteryPct": 26,
      "maxBatteryPct": 100,
      "binFullSampleCount": 2,
      "binFullEvents": 1,
      "missionsStarted": 1
    }
  ]
}
```

**Notes:**

- Buckets are returned in chronological order. Empty buckets are omitted.
- `estimated*` values use the same capped-delta approximation as the summary endpoint.

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
  "message": "Cleaning started",
  "requestId": "a1b2c3d4"
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
  "message": "Cleaning stopped",
  "requestId": "a1b2c3d4"
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
  "message": "Cleaning paused",
  "requestId": "a1b2c3d4"
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
  "message": "Cleaning resumed",
  "requestId": "a1b2c3d4"
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
  "message": "Returning to dock",
  "requestId": "a1b2c3d4"
}
```

---

### Clean Specific Rooms

Start a targeted cleaning mission for one or more rooms or segments discovered in the mission map.

```http
POST /api/cleanRooms
Content-Type: application/json

{
  "regions": [
    { "region_id": "kitchen" },
    "hallway"
  ],
  "ordered": true
}
```

**Request Body:**

- `regions` (required): Array of identifiers. Each entry can be a string (e.g. `"kitchen"`) or an object with `region_id`, optional `type`, and `params` for advanced firmware options.
- `ordered` (optional): When `true` (default), the robot follows the submitted order. Set to `false` to let the robot choose the path.
- `mapId` / `pmapId` (optional): Override the persistent map identifier. Defaults to the latest value tracked by the server.
- `userPmapvId` (optional): Pass-through for user map version identifiers, as required by some firmware revisions.

**Response:**

```json
{
  "success": true,
  "message": "Targeted clean started",
  "regions": [
    { "region_id": "kitchen" },
    "hallway"
  ],
  "requestId": "a1b2c3d4"
}
```

**Notes:**

- Robot must be connected and idle or paused to accept the command.
- Region identifiers come from `/api/map` (`regions[].id`) and live state updates (`state.position.regionId`).
- Errors from the robot (busy state, invalid region, etc.) are surfaced in the response.

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

Sent when an error occurs. For command failures, includes `command` and `requestId` for correlation.

```json
{
  "type": "error",
  "message": "Connection lost"
}
```

#### Command

Emitted when a control command is acknowledged server-side. Includes a `requestId` that matches the REST response header `x-request-id` and response body.

```json
{
  "type": "command",
  "command": "start",
  "requestId": "a1b2c3d4"
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

All error responses follow this standardized shape:

```json
{
  "error": "Human readable description",
  "code": "machine_readable_code"
}
```

Examples:

```json
{ "error": "Not connected to Roomba", "code": "not_connected" }
```

```json
{ "error": "Invalid range value", "code": "bad_request" }
```

Common HTTP status codes:

- `400 Bad Request` – Invalid input or precondition not met
- `404 Not Found` – Resource not available (e.g., mission map missing)
- `500 Internal Server Error` – Unexpected server or connectivity issue
- `503 Service Unavailable` – Dependent subsystem disabled (e.g., analytics store not initialized)

Error codes are stable identifiers intended for client logic.

---

## Request Correlation

The server supports end-to-end request correlation to make tracing easy:

- Clients may send an `x-request-id` header; if absent, the server generates one.
- The server echoes `x-request-id` in responses and includes `requestId` in JSON bodies for command endpoints and errors.
- WebSocket emits `command` and `error` messages with the matching `requestId` for correlation across channels.

Example:

```http
POST /api/start
x-request-id: a1b2c3d4
```

```json
{ "success": true, "message": "Cleaning started", "requestId": "a1b2c3d4" }
```

WebSocket:

```json
{ "type": "command", "command": "start", "requestId": "a1b2c3d4" }
```

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

---

## Scheduling

The server supports one-shot scheduling of core actions and targeted cleaning.

### Endpoints

- `GET /api/schedules` – list all schedules (sorted by time)
- `POST /api/schedules` – create a new one-shot schedule
- `POST /api/schedules` – create a new schedule (one-shot or recurring)
- `PATCH /api/schedules/:id` – update a pending schedule (time/action/payload/interval)
- `DELETE /api/schedules/:id` – cancel a pending schedule

### POST /api/schedules

Body fields:

```
{
  "action": "start",            // required: start|stop|pause|resume|dock|cleanRooms
  "when": 1731340800000,         // required: epoch ms OR ISO8601 string ("when" or "scheduledAt")
  "payload": {                   // optional; required for cleanRooms
    "regions": ["kitchen", "hall"],
    "ordered": true,
    "mapId": "pmap123",
    "userPmapvId": "1"
  },
  "intervalMs": 86400000        // optional: make schedule recurring every N ms
}
```

Response (201):

```
{
  "schedule": {
    "id": "abc123...",
    "action": "start",
    "scheduledAt": 1731340800000,
    "status": "pending",
    "createdAt": 1731337200000,
    "updatedAt": 1731337200000,
    "requestId": "req789"
  }
}
```

### GET /api/schedules

```
{
  "items": [ { "id": "...", "action": "start", "scheduledAt": 1731340800000, "status": "pending", ... } ]
}
```

### DELETE /api/schedules/:id

Returns the schedule after cancellation (status becomes `canceled` if still pending).

### Schedule Object Fields

- `id` – unique identifier
- `action` – scheduled action
- `payload` – optional payload (required for `cleanRooms`)
- `scheduledAt` – time in ms epoch
- `status` – `pending|canceled|executed|failed` (recurring schedules remain `pending` and reschedule after each run)
- `createdAt` / `updatedAt` – timestamps
- `executedAt` – timestamp when executed (for executed/failed)
- `requestId` – requestId of creation
- `executionRequestId` – requestId used when executing the action
- `intervalMs` – recurrence interval in ms (if set)
- `lastRunAt` – timestamp of the most recent execution (for recurring)
- `result` – `{ ok: true }` or `{ ok: false, message }` after latest execution

### WebSocket Scheduling Events

Scheduling lifecycle events broadcast with `type: "schedule"`:

```
{ "type": "schedule", "event": "created",   "schedule": { ... } }
{ "type": "schedule", "event": "executing", "schedule": { ... } }
{ "type": "schedule", "event": "executed",  "schedule": { ... } }
{ "type": "schedule", "event": "failed",    "schedule": { ... } }
{ "type": "schedule", "event": "canceled",  "schedule": { ... } }
{ "type": "schedule", "event": "updated",   "schedule": { ... } }
```

`executionRequestId` can be matched against command WebSocket events and the command audit trail (as `schedule:action`).

### Notes

- Recurring schedules are supported via `intervalMs`; they stay `pending` and reschedule after each run (even on failure).
- Maximum delay relies on Node's `setTimeout` capacity (~24.8 days); longer term schedules should be recreated after restart.
- Persistence lives at `var/schedules.json`; removing this file wipes pending schedules.
- If the robot is disconnected at execution time, the schedule fails (`status: failed`).

## Support

For API questions or issues, please refer to:

- [README.md](README.md) for general usage
- [PROTOCOL.md](PROTOCOL.md) for protocol details
- GitHub issues for bug reports
