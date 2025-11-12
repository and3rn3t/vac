# Roomba j9+ Local Control System

[![CI](https://github.com/and3rn3t/vac/actions/workflows/ci.yml/badge.svg)](https://github.com/and3rn3t/vac/actions/workflows/ci.yml)

Control your Roomba j9+ robot vacuum locally without iRobot cloud services. This system allows you to access all sensors, features, and controls through a local network connection, ensuring your Roomba continues to work even when cloud services are no longer available.

## Features

### 🎮 Full Local Control

- Start/Stop/Pause cleaning operations
- Return to dock command
- Targeted room/zone cleaning with custom labels (beta)
- Real-time status monitoring
- No cloud dependency

### 📊 Sensor Access

- Battery level monitoring
- Cleaning status and progress
- Position tracking
- Bin status detection
- Mission data (runtime, area cleaned)

### 🌐 Web Portal

- Modern, responsive web interface
- Real-time updates via WebSocket
- Works on desktop and mobile browsers
- Network discovery for easy setup

### 📱 Mobile App Shell

- Foundation for native mobile app development
- React-based architecture
- API integration ready

### 📈 Analytics

- Persistent telemetry logging to a local SQLite store
- `/api/analytics/*` endpoints for summaries and historical buckets
- Configurable retention window for long-running deployments

## Prerequisites

- Node.js (v14 or higher)
- npm or yarn
- Your Roomba j9+ on the same local network
- Roomba credentials (BLID and password)

## Quick Start

### 1. Installation

```bash
# Clone the repository
git clone https://github.com/and3rn3t/vac.git
cd vac

# Install dependencies
npm install
```

### 2. Getting Roomba Credentials

To connect to your Roomba, you need two pieces of information:

**BLID (Robot ID):**

- Found on the robot itself (under the lid or on a label)
- Can be discovered using the network discovery feature

**Password:**

1. Ensure your Roomba is on the dock and powered on
2. Press and hold the HOME button for about 2 seconds
3. The robot will play a tone and the light ring will flash
4. The robot is now in pairing mode for 2 minutes
5. Use the discovery feature or iRobot app to get the password

### 3. Configuration

Create a `.env` file in the root directory:

```bash
cp .env.example .env
```

Edit `.env` with your Roomba's information:

```env
ROOMBA_IP=192.168.1.100
ROOMBA_BLID=your_robot_blid_here
ROOMBA_PASSWORD=your_robot_password_here
PORT=3000
LOG_LEVEL=info
MQTT_PORT=8883
MQTT_USE_TLS=true
MQTT_KEEPALIVE_SEC=60
MQTT_RECONNECT_MS=5000
DISCOVERY_TIMEOUT_MS=5000
ANALYTICS_DB_PATH=./var/analytics.db
ANALYTICS_RETENTION_DAYS=90
```

`LOG_LEVEL` controls server verbosity (`error`, `warn`, `info`, `debug`). `MQTT_KEEPALIVE_SEC` and `MQTT_RECONNECT_MS` tune the connection to your robot, and `DISCOVERY_TIMEOUT_MS` adjusts how long `/api/discover` scans the network.

`ANALYTICS_DB_PATH` chooses where the SQLite database lives (defaults to `./var/analytics.db`) and `ANALYTICS_RETENTION_DAYS` controls how long historical samples are kept. Set retention to `0` or leave blank to keep all data.

### 4. Start the Server

```bash
npm start
```

The server will start on `http://localhost:3000`

### 5. Access the Web Interface

Open your browser and navigate to:

```text
http://localhost:3000
```

Or from another device on your network:

```text
http://[server-ip]:3000
```

## Usage

### Web Interface

1. **Discovery**: Click "Discover Roombas" to automatically find robots on your network
2. **Connect**: Enter your Roomba's IP, BLID, and password, then click "Connect"
3. **Control**: Use the control buttons to start cleaning, pause, stop, or return to dock
4. **Targeted Cleaning**: Select rooms/segments under *Rooms & Zones*, rename them for clarity, then launch a targeted clean when the button is enabled
5. **Monitor**: View real-time status updates including battery, position, and cleaning progress

### API Endpoints

The server provides a REST API for programmatic control:

#### Connection

- `GET /api/health` - Server health check
- `GET /api/discover` - Discover Roombas on network
- `POST /api/connect` - Connect to a Roomba
- `POST /api/disconnect` - Disconnect from Roomba

#### Control

- `POST /api/start` - Start cleaning
- `POST /api/stop` - Stop cleaning
- `POST /api/pause` - Pause cleaning
- `POST /api/resume` - Resume cleaning
- `POST /api/dock` - Return to dock
- `POST /api/cleanRooms` - Start a targeted clean for specific rooms/segments (`regions` array required)

#### Status

- `GET /api/state` - Get current robot state

#### Analytics

- `GET /api/analytics/summary` - Aggregate metrics over an optional range (e.g. `?range=7d`)
- `GET /api/analytics/history` - Time-bucketed trends with optional `range` and `bucket` (e.g. `?range=30d&bucket=1d`)

#### WebSocket

Connect to `ws://[server-ip]:3000` for real-time updates.

Messages received:

```json
{
  "type": "stateUpdate",
  "data": {
    "battery": 85,
    "cleaning": true,
    "binFull": false,
    "position": { "x": 100, "y": 200, "theta": 45 },
    "mission": { ... }
  }
}
```

## Architecture

### Backend (Node.js)

- **Express**: REST API server
- **MQTT**: Communication with Roomba using iRobot protocol
- **WebSocket**: Real-time updates to clients
- **UDP Discovery**: Network-based robot discovery

### Frontend (Vanilla JS)

- Modern, responsive web interface
- Real-time status updates
- Mobile-friendly design

### Communication Protocol

- Uses MQTT over TLS (port 8883) or non-TLS (port 1883)
- AWS IoT-style topics for command and status
- JSON message format

See [PROTOCOL.md](PROTOCOL.md) for detailed protocol information.

## Troubleshooting

### Can't Connect to Roomba

1. **Check Network**: Ensure your computer and Roomba are on the same network
2. **Verify Credentials**: Double-check your BLID and password
3. **Firewall**: Make sure ports 8883 (MQTT) and 5678 (UDP discovery) are not blocked
4. **Robot State**: Ensure the Roomba is awake (press the CLEAN button)

### Discovery Not Finding Robots

1. **Network Configuration**: Discovery uses UDP broadcast, which may not work across VLANs
2. **Manual Entry**: If discovery fails, manually enter the IP address
3. **Check Router**: Some routers block broadcast traffic

### Connection Drops

1. **Network Stability**: Ensure stable WiFi connection
2. **Robot Sleep**: Roomba may sleep after inactivity, press CLEAN button to wake
3. **Check Logs**: View console logs for error messages

## Development

### Project Structure

```text
vac/
├── server/              # Backend server
│   ├── index.js        # Main server file
│   ├── roomba-client.js # Roomba MQTT client
│   └── discovery.js    # Network discovery
├── public/             # Web interface
│   ├── index.html
│   ├── styles.css
│   └── app.js
├── mobile-app/         # Mobile app shell
│   └── src/
├── PROTOCOL.md         # Protocol documentation
└── README.md
```

### Running in Development

```bash
# Install dev dependencies
npm install

# Start with auto-reload
npm run dev

# Run unit tests
npm test

# Run lint
npm run lint
```

### Adding Features

The modular architecture makes it easy to add new features:

1. **New Commands**: Add methods to `RoombaClient` class
2. **New API Endpoints**: Add routes in `server/index.js`
3. **UI Updates**: Modify files in `public/` directory

## Mobile App Development

The `mobile-app/` directory contains a shell for future mobile app development. See [mobile-app/README.md](mobile-app/README.md) for details.

## Security Considerations

- **Local Network Only**: This system is designed for local network use
- **TLS**: Uses TLS for MQTT communication
- **No External Access**: Not designed for internet exposure
- **Credentials**: Keep your `.env` file secure and never commit it to version control

## Contributing

Contributions are welcome! Areas for improvement:

- Enhanced mapping visualization
- Room-specific cleaning
- Advanced schedule management (enhancements)
- Additional sensor data parsing
- Mobile app development
- Multi-robot support

### Continuous Integration & Testing

This repository includes a GitHub Actions workflow (`.github/workflows/ci.yml`) that runs on pushes and pull requests targeting `main`:

Steps performed:

1. Install dependencies (`npm ci` when lockfile present)
2. Run ESLint (`npm run lint`)
3. Execute the Node test suite (`npm test`)

Local verification before opening a PR:

```bash
npm install
npm run lint
npm test
```

Testing uses the built-in Node.js test runner (`node --test`). The server exports a `startServer()` helper and avoids auto-start when imported, enabling fast integration tests that bind to an ephemeral port. A `stopServer()` helper ensures clean shutdown between tests.

If you add new features:

- Prefer adding unit tests alongside the feature under `tests/`
- Keep public API changes reflected in `API.md`
- Update `FEATURES.md` / `SETUP.md` where relevant
- Avoid hardcoding secrets; use `.env` pattern

## License

MIT License - See LICENSE file for details

## Disclaimer

This is an independent project and is not affiliated with or endorsed by iRobot Corporation. Use at your own risk. The author is not responsible for any damage to your robot or property.

## Acknowledgments

- iRobot for creating amazing robots
- The open-source community for protocol reverse-engineering efforts
- Projects like dorita980 and Roomba980-python for inspiration

## Support

For issues and questions:

- Open an issue on GitHub
- Check existing issues for solutions
- Review the PROTOCOL.md for technical details
