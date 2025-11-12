<!-- markdownlint-disable MD022 MD031 MD032 MD036 MD040 -->

# Setup Guide

This guide will walk you through setting up the Roomba Local Control System from scratch.

## Step 1: Install Prerequisites

### Node.js
Download and install Node.js from [nodejs.org](https://nodejs.org/)

Verify installation (Node 20 recommended):
```bash
node --version  # Should be v18+ (20 recommended)
npm --version
```

## Step 2: Get Roomba Credentials

### Finding Your BLID (Robot ID)

**Method 1: Physical Label**
- Flip your Roomba over or open the lid
- Look for a label with the robot ID/BLID

**Method 2: Network Discovery**
- Start the server (continue with setup)
- Use the "Discover Roombas" button in the web interface

**Method 3: iRobot App**
- Open the iRobot HOME app
- Go to Settings → About → Robot Information
- Note the Robot ID

### Getting the Password

The password must be retrieved while the robot is in pairing mode:

1. **Place Roomba on the dock** and ensure it's powered on
2. **Press and hold the HOME button** for about 2 seconds
3. **Listen for a tone** - the robot will beep and the light ring will flash
4. **The robot is now in pairing mode** for 2 minutes

**Option A: Using this software**
- In the web interface, click "Discover Roombas"
- The password may be included in the discovery response

**Option B: Manual extraction (advanced)**
- Use network packet capture tools
- Monitor MQTT traffic during pairing
- Extract password from connection attempt

**Note**: You only need to get the password once. Store it securely.

## Step 3: Install the Software

```bash
# Clone the repository
git clone https://github.com/and3rn3t/vac.git
cd vac

# Install dependencies
npm install
```

## Step 4: Configure

### Create Configuration File

```bash
cp .env.example .env
```

### Edit Configuration

Open `.env` in a text editor and fill in your details:

```env
# Your Roomba's IP address
# Find this in your router's DHCP client list or use discovery
ROOMBA_IP=192.168.1.100

# Your Roomba's BLID (from Step 2)
ROOMBA_BLID=ABCDEF1234567890

# Your Roomba's password (from Step 2)
ROOMBA_PASSWORD=:1:2345678901:AbCdEfGhIjKlMnOp

# Server port (optional)
PORT=3000
LOG_LEVEL=info

# MQTT settings (optional)
MQTT_PORT=8883
MQTT_USE_TLS=true
MQTT_KEEPALIVE_SEC=60
MQTT_RECONNECT_MS=5000

# Discovery settings (optional)
DISCOVERY_TIMEOUT_MS=5000

# Analytics settings (optional)
ANALYTICS_DB_PATH=./var/analytics.db
ANALYTICS_RETENTION_DAYS=90
```

`LOG_LEVEL` accepts `error`, `warn`, `info`, or `debug` to control console verbosity. `MQTT_KEEPALIVE_SEC` and `MQTT_RECONNECT_MS` let you tune the robot connection, and `DISCOVERY_TIMEOUT_MS` changes how long the discovery scan waits for responses.

`ANALYTICS_DB_PATH` selects where the local SQLite database is created (defaults to `./var/analytics.db`) and `ANALYTICS_RETENTION_DAYS` controls how long telemetry samples are retained. Set retention to `0` to keep everything.

## Step 5: Start the Server

```bash
npm start
```

You should see:
```
🤖 Roomba Local Control Server running on port 3000
📱 Web interface: http://localhost:3000
🔌 WebSocket: ws://localhost:3000
Connected to Roomba!
```

## Step 6: Access the Web Interface

Open your browser and navigate to:
- Local: `http://localhost:3000`
- From other devices: `http://[your-computer-ip]:3000`

## Step 7: First Connection

If you didn't configure credentials in `.env`:

1. Click **"Discover Roombas"** to find your robot
2. Fill in the **IP Address**, **BLID**, and **Password**
3. Click **"Connect"**

The status indicator should turn green when connected.

## Step 8: Test Controls

Try the basic controls:
- **Start Cleaning**: Should start a cleaning mission
- **Pause**: Should pause the current mission
- **Stop**: Should stop and prepare to return home
- **Return to Dock**: Should navigate back to charging base
- **Targeted Clean**: Once a mission map has loaded, choose rooms under *Rooms & Zones* and start a focused clean. Use the rename option to label rooms for quick reference.

## Step 9: Verify the Installation (Optional)

Run the automated checks to ensure everything is wired correctly:

```bash
npm test      # Node.js built-in test runner
npm run lint  # ESLint static analysis
```

Tests cover targeted-clean payload building, state normalization, analytics, and scheduling (including recurring + update flows). Linting enforces basic code quality standards.

## Common Setup Issues

### Issue: Server won't start

**Solution:**
- Check if port 3000 is already in use
- Change the PORT in `.env` to another value (e.g., 3001)

### Issue: Can't find Roomba IP address

**Solutions:**
1. Check your router's admin interface for connected devices
2. Look for "iRobot" or "Roomba" in the device list
3. Use network scanning tools like `nmap`:
   ```bash
   nmap -sn 192.168.1.0/24
   ```

### Issue: Discovery doesn't find Roomba

**Solutions:**
- Ensure Roomba is powered on and connected to WiFi
- Wake the Roomba by pressing the CLEAN button
- Check that your computer and Roomba are on the same network/VLAN
- Manually enter the IP address instead

### Issue: Connection fails with credentials

**Solutions:**
- Verify BLID is correct (check physical label)
- Ensure password was captured during pairing mode
- Try getting password again (hold HOME button)
- Check that Roomba is awake (not sleeping)

### Issue: Connection drops frequently

**Solutions:**
- Improve WiFi signal strength
- Move Roomba closer to router
- Check for network interference
- Ensure router isn't blocking MQTT traffic

## Network Configuration

### Port Requirements

The system uses these ports:
- **3000** (HTTP): Web interface and REST API
- **8883** (MQTT/TLS): Communication with Roomba
- **5678** (UDP): Robot discovery

### Firewall Rules

If using a firewall, allow:
- Outgoing MQTT (8883)
- UDP broadcast (5678)
- Incoming HTTP (3000)

### Static IP for Roomba

Recommended: Set a static IP for your Roomba in your router's DHCP settings to prevent the IP address from changing.

## Running as a Service

### Linux (systemd)

Create `/etc/systemd/system/roomba-control.service`:

```ini
[Unit]
Description=Roomba Local Control
After=network.target

[Service]
Type=simple
User=yourusername
WorkingDirectory=/path/to/vac
ExecStart=/usr/bin/node server/index.js
Restart=always
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

Enable and start:
```bash
sudo systemctl enable roomba-control
sudo systemctl start roomba-control
```

### macOS (launchd)

Create `~/Library/LaunchAgents/com.roomba.control.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.roomba.control</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/local/bin/node</string>
        <string>/path/to/vac/server/index.js</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
</dict>
</plist>
```

Load the service:
```bash
launchctl load ~/Library/LaunchAgents/com.roomba.control.plist
```

## Next Steps

- Explore the web interface features
- Set up mobile access
- Integrate with home automation (future feature)
- Consider running on a Raspberry Pi for 24/7 operation

## Getting Help

If you encounter issues not covered here:
1. Check the main [README.md](README.md)
2. Review [PROTOCOL.md](PROTOCOL.md) for technical details
3. Check server logs for error messages
4. Open an issue on GitHub with details
