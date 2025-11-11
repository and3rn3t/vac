/**
 * Roomba Client - Handles communication with Roomba j9+ over local network
 * Uses MQTT protocol for local control without cloud services
 */

const mqtt = require('mqtt');
const EventEmitter = require('events');

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

function firstDefined(...values) {
  for (let i = 0; i < values.length; i += 1) {
    const value = values[i];
    if (value !== undefined && value !== null) {
      return value;
    }
  }
  return null;
}

function coerceString(value) {
  if (value === undefined || value === null) {
    return null;
  }
  return String(value);
}

class RoombaClient extends EventEmitter {
  constructor(config) {
    super();
    this.config = {
      ip: config.ip,
      blid: config.blid,
      password: config.password,
      port: config.port || 8883,
      useTLS: config.useTLS !== false,
      keepalive: Number.isFinite(config.keepalive) ? config.keepalive : 60,
      reconnectPeriod: Number.isFinite(config.reconnectPeriod) ? config.reconnectPeriod : 5000
    };
    this.client = null;
    this.connected = false;
    this.robotState = {
      battery: null,
      cleaning: false,
      binFull: false,
      position: { x: 0, y: 0, theta: 0, segmentId: null, regionId: null },
      mission: null,
      mapId: null,
      regions: [],
      segments: [],
      userPmapvId: null,
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
        keepalive: this.config.keepalive,
        reconnectPeriod: this.config.reconnectPeriod
      };

      log('info', `Connecting to Roomba at ${url} (keepalive ${options.keepalive}s, reconnect ${options.reconnectPeriod}ms)...`);
      this.client = mqtt.connect(url, options);

      this.client.on('connect', () => {
        log('info', 'Connected to Roomba!');
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
        log('error', 'MQTT Error:', error.message);
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
      const mission = reported.cleanMissionStatus;
      this.robotState.cleaning = mission.phase === 'run';
      this.robotState.mission = mission;

      const mapIdCandidate = firstDefined(mission.pmap_id, mission.pmapId, mission.mapId, this.robotState.mapId);
      if (mapIdCandidate) {
        this.robotState.mapId = mapIdCandidate;
      }

      const missionRegions = Array.isArray(mission.regions) ? mission.regions : null;
      if (missionRegions) {
        this.robotState.regions = missionRegions;
      }

      const missionSegments = Array.isArray(mission.mapSegs)
        ? mission.mapSegs.map((seg) => coerceString(seg)).filter(Boolean)
        : null;
      if (missionSegments && missionSegments.length) {
        this.robotState.segments = missionSegments;
      }

      const userPmapvId = firstDefined(
        mission.user_pmapv_id,
        mission.userPmapvId,
        this.robotState.userPmapvId
      );
      if (userPmapvId) {
        this.robotState.userPmapvId = userPmapvId;
      }
    }
    if (reported.bin) {
      this.robotState.binFull = reported.bin.full;
    }
    if (reported.pose) {
      const mission = this.robotState.mission || {};
      const pose = reported.pose;
      const poseSegment = firstDefined(
        pose.seg,
        pose.segment,
        pose.segmentId,
        pose.nodeId,
        mission.segmentId,
        mission.activeSegment,
        Array.isArray(mission.mapSegs) ? mission.mapSegs[mission.mapSegs.length - 1] : null
      );
      const poseRegion = firstDefined(
        pose.regionId,
        pose.region_id,
        pose.region,
        mission.regionId,
        mission.activeRegion,
        mission.region,
        mission.currentRegion
      );

      this.robotState.position = {
        x: Number.isFinite(pose.point?.x) ? pose.point.x : 0,
        y: Number.isFinite(pose.point?.y) ? pose.point.y : 0,
        theta: Number.isFinite(pose.theta) ? pose.theta : 0,
        segmentId: coerceString(poseSegment),
        regionId: coerceString(poseRegion)
      };
    }

    if (reported.lastCommand) {
      const lastMapId = firstDefined(
        reported.lastCommand.pmap_id,
        reported.lastCommand.pmapId,
        this.robotState.mapId
      );
      if (lastMapId) {
        this.robotState.mapId = lastMapId;
      }

      const lastUserPmapvId = firstDefined(
        reported.lastCommand.user_pmapv_id,
        reported.lastCommand.userPmapvId,
        this.robotState.userPmapvId
      );
      if (lastUserPmapvId) {
        this.robotState.userPmapvId = lastUserPmapvId;
      }
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
          log('debug', `Command sent: ${command}`);
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
   * Trigger a targeted clean for specific regions/segments
   */
  async cleanRooms(options = {}) {
    if (!this.connected) {
      throw new Error('Not connected to Roomba');
    }

    const inputRegions = Array.isArray(options.regions) ? options.regions : [];
    const normalizedRegions = inputRegions
      .map((region) => {
        const source = region && typeof region === 'object' ? region : {};
        const regionId = coerceString(
          source.region_id ?? source.regionId ?? source.id ?? region
        );
        if (!regionId) {
          log('warn', 'Skipping targeted clean region with missing identifier', region);
          return null;
        }

        const normalized = {
          region_id: regionId,
          type: source.type || 'rid'
        };

        if (source.params && typeof source.params === 'object') {
          normalized.params = source.params;
        }

        return normalized;
      })
      .filter(Boolean);

    if (!normalizedRegions.length) {
      throw new Error('At least one valid region is required');
    }

    const payload = {
      ordered: options.ordered === false ? 0 : 1,
      regions: normalizedRegions
    };

    const resolvedMapId = firstDefined(
      options.mapId,
      options.pmapId,
      this.robotState.mapId
    );
    if (resolvedMapId) {
      payload.pmap_id = resolvedMapId;
    }

    const resolvedUserPmapvId = firstDefined(
      options.userPmapvId,
      this.robotState.userPmapvId
    );
    if (resolvedUserPmapvId) {
      payload.user_pmapv_id = resolvedUserPmapvId;
    }

    log('info', 'Dispatching targeted clean command', {
      regions: normalizedRegions.map((region) => region.region_id),
      ordered: payload.ordered === 1,
      mapId: payload.pmap_id || null,
      userPmapvId: payload.user_pmapv_id || null
    });

    await this.sendCommand('start', payload);
    log('info', 'Targeted clean command acknowledged by MQTT broker');
    return;
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
