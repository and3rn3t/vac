# Roomba j9+ Communication Protocol

## Overview

The Roomba j9+ communicates using the iRobot Open Interface (OI) protocol over various methods:

- MQTT (for WiFi-connected models)
- Serial connection (for direct wired connection)
- REST API (local network)

## Connection Methods

### 1. Local MQTT Connection

- The Roomba j9+ uses MQTT for local network communication
- Default port: 8883 (TLS) or 1883 (non-TLS)
- Authentication: Username/password (robot BLID and password)
- Topics follow pattern: `$aws/things/{robotid}/...`

### 2. Getting Robot Credentials

To connect locally, you need:

- **BLID**: Robot's unique identifier (visible on the robot or via UDP broadcast)
- **Password**: Retrieved by pressing the HOME button for 2 seconds until it plays a tone

### 3. Discovery

- Robots broadcast their presence on UDP port 5678
- Send broadcast to discover robots on local network

## Command Structure

### MQTT Topics

- Status: `wifistat`
- Commands: `cmd`
- Delta updates: `delta`

### Common Commands

```json
{
  "command": "start",
  "time": timestamp,
  "initiator": "localApp"
}
```

### Status Messages

Robot publishes status updates including:

- Battery level
- Cleaning state
- Position/location
- Bin status
- Error codes
- Mission data

## Implementation Notes

- Use TLS for secure communication
- Handle reconnection logic
- Parse binary telemetry data
- Maintain persistent connection for real-time updates

## References

- iRobot Open Interface Specification
- Roomba WiFi specifications
- Community reverse-engineering efforts (dorita980, Roomba980-python)
