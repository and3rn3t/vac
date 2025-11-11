/**
 * Roomba Client - Handles communication with Roomba j9+ over local network
 * Uses MQTT protocol for local control without cloud services
 */

const mqtt = require('mqtt');
const EventEmitter = require('events');

class RoombaClient extends EventEmitter {
  constructor(config) {
    super();
    this.config = {
      ip: config.ip,
      blid: config.blid,
      password: config.password,
      port: config.port || 8883,
      useTLS: config.useTLS !== false
    };
    this.client = null;
    this.connected = false;
    this.robotState = {
      battery: null,
      cleaning: false,
      binFull: false,
      position: { x: 0, y: 0, theta: 0 },
      mission: null,
      error: null
    };
  }

  /**
   * Connect to the Roomba
   */
  async connect() {
    return new Promise((resolve, reject) => {
      const protocol = this.config.useTLS ? 'mqtts' : 'mqtt';
      const url = `${protocol}://${this.config.ip}:${this.config.port}`;
      
      const options = {
        clientId: 'roomba-local-' + Math.random().toString(16).substr(2, 8),
        username: this.config.blid,
        password: this.config.password,
        rejectUnauthorized: false, // Self-signed certs
        keepalive: 60,
        reconnectPeriod: 5000
      };

      console.log(`Connecting to Roomba at ${url}...`);
      this.client = mqtt.connect(url, options);

      this.client.on('connect', () => {
        console.log('Connected to Roomba!');
        this.connected = true;
        
        // Subscribe to status topics
        this.client.subscribe('$aws/things/' + this.config.blid + '/shadow/update/accepted');
        this.client.subscribe('$aws/things/' + this.config.blid + '/shadow/update/delta');
        
        this.emit('connected');
        resolve();
      });

      this.client.on('message', (topic, message) => {
        this.handleMessage(topic, message);
      });

      this.client.on('error', (error) => {
        console.error('MQTT Error:', error.message);
        this.emit('error', error);
        reject(error);
      });

      this.client.on('close', () => {
        this.connected = false;
        this.emit('disconnected');
      });

      // Timeout after 10 seconds
      setTimeout(() => {
        if (!this.connected) {
          reject(new Error('Connection timeout'));
        }
      }, 10000);
    });
  }

  /**
   * Handle incoming messages from Roomba
   */
  handleMessage(topic, message) {
    try {
      const data = JSON.parse(message.toString());
      
      if (data.state && data.state.reported) {
        this.updateState(data.state.reported);
      }
      
      this.emit('message', { topic, data });
    } catch (error) {
      console.error('Error parsing message:', error);
    }
  }

  /**
   * Update internal state from robot data
   */
  updateState(reported) {
    if (reported.batPct !== undefined) {
      this.robotState.battery = reported.batPct;
    }
    if (reported.cleanMissionStatus) {
      this.robotState.cleaning = reported.cleanMissionStatus.phase === 'run';
      this.robotState.mission = reported.cleanMissionStatus;
    }
    if (reported.bin) {
      this.robotState.binFull = reported.bin.full;
    }
    if (reported.pose) {
      this.robotState.position = {
        x: reported.pose.point?.x || 0,
        y: reported.pose.point?.y || 0,
        theta: reported.pose.theta || 0
      };
    }
    
    this.emit('stateUpdate', this.robotState);
  }

  /**
   * Send a command to the Roomba
   */
  async sendCommand(command, params = {}) {
    if (!this.connected) {
      throw new Error('Not connected to Roomba');
    }

    const topic = `cmd`;
    const payload = {
      command: command,
      time: Math.floor(Date.now() / 1000),
      initiator: 'localApp',
      ...params
    };

    return new Promise((resolve, reject) => {
      this.client.publish(topic, JSON.stringify(payload), (error) => {
        if (error) {
          reject(error);
        } else {
          console.log(`Command sent: ${command}`);
          resolve();
        }
      });
    });
  }

  /**
   * Start cleaning
   */
  async start() {
    return this.sendCommand('start');
  }

  /**
   * Stop cleaning and return to dock
   */
  async stop() {
    return this.sendCommand('stop');
  }

  /**
   * Pause cleaning
   */
  async pause() {
    return this.sendCommand('pause');
  }

  /**
   * Resume cleaning
   */
  async resume() {
    return this.sendCommand('resume');
  }

  /**
   * Return to dock
   */
  async dock() {
    return this.sendCommand('dock');
  }

  /**
   * Get current robot state
   */
  getState() {
    return { ...this.robotState, connected: this.connected };
  }

  /**
   * Disconnect from Roomba
   */
  disconnect() {
    if (this.client) {
      this.client.end();
      this.connected = false;
    }
  }
}

module.exports = RoombaClient;
