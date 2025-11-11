/**
 * Roomba Discovery - Find Roombas on the local network
 * Uses UDP broadcast to discover robots
 */

const dgram = require('dgram');
const EventEmitter = require('events');

class RoombaDiscovery extends EventEmitter {
  constructor() {
    super();
    this.socket = null;
    this.discoveredRobots = new Map();
  }

  /**
   * Start discovery process
   * Broadcasts on UDP port 5678 to find Roombas
   */
  async discover(timeout = 5000) {
    return new Promise((resolve, reject) => {
      this.socket = dgram.createSocket('udp4');
      const discoveredDevices = [];

      this.socket.on('error', (err) => {
        console.error('Discovery socket error:', err);
        this.socket.close();
        reject(err);
      });

      this.socket.on('message', (msg, rinfo) => {
        try {
          const message = msg.toString();
          
          // Parse the response - Roomba broadcasts its BLID and other info
          if (message.includes('iRobot') || message.includes('Roomba')) {
            const device = {
              ip: rinfo.address,
              message: message,
              timestamp: Date.now()
            };

            // Try to extract BLID if present in message
            const blidMatch = message.match(/blid["\s:]+([A-Za-z0-9]+)/i);
            if (blidMatch) {
              device.blid = blidMatch[1];
            }

            // Try to extract robot name
            const nameMatch = message.match(/robotname["\s:]+([^"]+)/i);
            if (nameMatch) {
              device.name = nameMatch[1];
            }

            const key = device.blid || device.ip;
            if (!this.discoveredRobots.has(key)) {
              this.discoveredRobots.set(key, device);
              discoveredDevices.push(device);
              this.emit('robot', device);
              console.log('Discovered Roomba:', device);
            }
          }
        } catch (error) {
          console.error('Error parsing discovery response:', error);
        }
      });

      this.socket.on('listening', () => {
        const address = this.socket.address();
        console.log(`Discovery listening on ${address.address}:${address.port}`);
        this.socket.setBroadcast(true);

        // Send discovery broadcast
        const message = Buffer.from('iRobot');
        this.socket.send(message, 0, message.length, 5678, '255.255.255.255', (err) => {
          if (err) {
            console.error('Error sending broadcast:', err);
          }
        });
      });

      // Bind to discovery port
      this.socket.bind(5678);

      // Stop discovery after timeout
      setTimeout(() => {
        this.stop();
        resolve(discoveredDevices);
      }, timeout);
    });
  }

  /**
   * Stop discovery
   */
  stop() {
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
  }

  /**
   * Get all discovered robots
   */
  getDiscoveredRobots() {
    return Array.from(this.discoveredRobots.values());
  }

  /**
   * Clear discovered robots
   */
  clear() {
    this.discoveredRobots.clear();
  }
}

module.exports = RoombaDiscovery;
