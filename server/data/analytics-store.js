/**
 * AnalyticsStore persists Roomba state telemetry into SQLite and provides
 * aggregate views for analytics endpoints.
 */

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_INTERVAL_MS = 5 * 60 * 1000; // cap gaps between samples when estimating durations
const DEFAULT_MAP_MAX_POINTS = 2000;
const MAX_MAP_POINTS = 5000;

function resolveDbPath(customPath) {
  if (customPath) {
    return path.resolve(customPath);
  }
  // Default to repo-root/var/analytics.db
  return path.join(__dirname, '../../var/analytics.db');
}

function ensureDirectoryFor(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function deriveMissionIdentifier(mission) {
  if (!mission || typeof mission !== 'object') {
    return null;
  }

  return (
    mission.missionId ||
    mission.mssid ||
    mission.mssnId ||
    mission.sMissionId ||
    mission.runId ||
    mission.cMissionId ||
    (mission.cycle && (mission.nMssn !== undefined ? `${mission.cycle}:${mission.nMssn}` : mission.cycle)) ||
    null
  );
}

function clampInterval(delta) {
  if (!Number.isFinite(delta) || delta <= 0) {
    return 0;
  }
  return Math.min(delta, MAX_INTERVAL_MS);
}

class AnalyticsStore {
  constructor(options = {}) {
    const dbPath = resolveDbPath(options.dbPath);
    ensureDirectoryFor(dbPath);

    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');

    this._prepareSchema();

    const retentionDays = options.retentionDays ?? parseInt(process.env.ANALYTICS_RETENTION_DAYS || '90', 10);
    this.retentionMs = Number.isFinite(retentionDays) && retentionDays > 0 ? retentionDays * DAY_MS : null;
    this._insertCounter = 0;

    this.statements = {
      insertSample: this.db.prepare(
        `INSERT INTO state_samples (
            timestamp,
            battery_pct,
            bin_full,
            cleaning,
            phase,
            cycle,
            mission_identifier,
            mission_json,
            pose_x,
            pose_y,
            pose_theta
          ) VALUES (@timestamp, @battery_pct, @bin_full, @cleaning, @phase, @cycle, @mission_identifier, @mission_json, @pose_x, @pose_y, @pose_theta)`
      ),
      deleteOlderThan: this.db.prepare('DELETE FROM state_samples WHERE timestamp < @threshold'),
      selectRange: this.db.prepare(
        `SELECT id, timestamp, battery_pct, bin_full, cleaning, phase, cycle, mission_identifier
         FROM state_samples
         WHERE (@cutoff IS NULL OR timestamp >= @cutoff)
         ORDER BY timestamp`
      ),
      selectLatestMission: this.db.prepare(
        `SELECT mission_identifier AS missionId,
                MIN(timestamp) AS startedAt,
                MAX(timestamp) AS endedAt
         FROM state_samples
         WHERE mission_identifier IS NOT NULL
         GROUP BY mission_identifier
         ORDER BY endedAt DESC
         LIMIT 1`
      ),
      selectMissionBounds: this.db.prepare(
        `SELECT mission_identifier AS missionId,
                MIN(timestamp) AS startedAt,
                MAX(timestamp) AS endedAt
         FROM state_samples
         WHERE mission_identifier = @missionId`
      ),
      selectMissionPath: this.db.prepare(
        `SELECT timestamp,
                pose_x AS x,
                pose_y AS y,
                pose_theta AS theta
         FROM state_samples
         WHERE mission_identifier = @missionId
           AND pose_x IS NOT NULL
           AND pose_y IS NOT NULL
         ORDER BY timestamp`
      ),
      selectMissionDetails: this.db.prepare(
        `SELECT mission_json AS missionJson
         FROM state_samples
         WHERE mission_identifier = @missionId
           AND mission_json IS NOT NULL
         ORDER BY timestamp DESC
         LIMIT 1`
      )
    };
  }

  _prepareSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS state_samples (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER NOT NULL,
        battery_pct REAL,
        bin_full INTEGER NOT NULL DEFAULT 0,
        cleaning INTEGER NOT NULL DEFAULT 0,
        phase TEXT,
        cycle TEXT,
        mission_identifier TEXT,
        mission_json TEXT,
        pose_x REAL,
        pose_y REAL,
        pose_theta REAL
      );

      CREATE INDEX IF NOT EXISTS idx_state_samples_timestamp ON state_samples(timestamp);
      CREATE INDEX IF NOT EXISTS idx_state_samples_mission ON state_samples(mission_identifier);
    `);
  }

  recordTelemetry(state) {
    if (!state || typeof state !== 'object') {
      return;
    }

    // Prepare mission metadata if present
    const mission = state.mission && typeof state.mission === 'object' ? state.mission : null;
    let missionJson = null;
    if (mission) {
      try {
        missionJson = JSON.stringify(mission);
      } catch (error) {
        missionJson = null;
      }
    }

    const telemetry = {
      timestamp: Date.now(),
      battery_pct: Number.isFinite(state.battery) ? state.battery : null,
      bin_full: state.binFull ? 1 : 0,
      cleaning: state.cleaning ? 1 : 0,
      phase: mission ? mission.phase ?? null : null,
      cycle: mission ? mission.cycle ?? null : null,
      mission_identifier: deriveMissionIdentifier(mission),
      mission_json: missionJson,
      pose_x: state.position && Number.isFinite(state.position.x) ? state.position.x : null,
      pose_y: state.position && Number.isFinite(state.position.y) ? state.position.y : null,
      pose_theta: state.position && Number.isFinite(state.position.theta) ? state.position.theta : null
    };

    try {
      this.statements.insertSample.run(telemetry);
      this._insertCounter = (this._insertCounter + 1) % 100;
      if (this._insertCounter === 0) {
        this._pruneIfNeeded();
      }
    } catch (error) {
      // Logging is deferred to caller; swallow to avoid crashing telemetry pipeline
      if (process.env.LOG_LEVEL && process.env.LOG_LEVEL.toLowerCase() === 'debug') {
        console.error('AnalyticsStore insert failed:', error);
      }
    }
  }

  _pruneIfNeeded() {
    if (!this.retentionMs) {
      return;
    }
    const threshold = Date.now() - this.retentionMs;
    try {
      this.statements.deleteOlderThan.run({ threshold });
    } catch (error) {
      if (process.env.LOG_LEVEL && process.env.LOG_LEVEL.toLowerCase() === 'debug') {
        console.error('AnalyticsStore prune failed:', error);
      }
    }
  }

  _fetchSamples(rangeMs) {
    const cutoff = Number.isFinite(rangeMs) ? Date.now() - rangeMs : null;
    return this.statements.selectRange.all({ cutoff });
  }

  getSummary(options = {}) {
    const rangeMs = options.rangeMs ?? 30 * DAY_MS;
    const rows = this._fetchSamples(rangeMs);
    if (!rows.length) {
      return {
        rangeMs,
        sampleCount: 0,
        rangeStart: null,
        rangeEnd: null,
        cleaningSampleCount: 0,
        estimatedCleaningMs: 0,
        averageBatteryPct: null,
        minBatteryPct: null,
        maxBatteryPct: null,
        binFullEvents: 0,
        missionsStarted: 0
      };
    }

    let cleaningSampleCount = 0;
    let binFullEvents = 0;
    let missionsStarted = 0;
    let prevBinFull = rows[0].bin_full === 1;
    let prevPhase = rows[0].phase || null;

    let batterySum = 0;
    let batteryCount = 0;
    let minBattery = Infinity;
    let maxBattery = -Infinity;

    let totalDurationMs = 0;
    let cleaningDurationMs = 0;

    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i];

      if (row.cleaning) {
        cleaningSampleCount += 1;
      }

      if (row.bin_full === 1 && prevBinFull === 0) {
        binFullEvents += 1;
      }
      prevBinFull = row.bin_full === 1 ? 1 : 0;

      const phase = row.phase || null;
      if (phase === 'run' && prevPhase !== 'run') {
        missionsStarted += 1;
      }
      prevPhase = phase;

      if (Number.isFinite(row.battery_pct)) {
        batterySum += row.battery_pct;
        batteryCount += 1;
        if (row.battery_pct < minBattery) minBattery = row.battery_pct;
        if (row.battery_pct > maxBattery) maxBattery = row.battery_pct;
      }

      if (i < rows.length - 1) {
        const nextRow = rows[i + 1];
        const interval = clampInterval(nextRow.timestamp - row.timestamp);
        totalDurationMs += interval;
        if (row.cleaning) {
          cleaningDurationMs += interval;
        }
      }
    }

    const averageBatteryPct = batteryCount ? batterySum / batteryCount : null;

    return {
      rangeMs,
      sampleCount: rows.length,
      rangeStart: rows[0].timestamp,
      rangeEnd: rows[rows.length - 1].timestamp,
      cleaningSampleCount,
      estimatedCleaningMs: cleaningDurationMs,
      estimatedTotalMs: totalDurationMs,
      averageBatteryPct,
      minBatteryPct: batteryCount ? minBattery : null,
      maxBatteryPct: batteryCount ? maxBattery : null,
      binFullEvents,
      missionsStarted
    };
  }

  getHistory(options = {}) {
    const rangeMs = options.rangeMs ?? 30 * DAY_MS;
    const bucketSizeMs = options.bucketSizeMs ?? this._suggestBucketSize(rangeMs);
    const rows = this._fetchSamples(rangeMs);

    const buckets = new Map();

    const ensureBucket = (bucketStart) => {
      if (!buckets.has(bucketStart)) {
        buckets.set(bucketStart, {
          start: bucketStart,
          end: bucketStart + bucketSizeMs,
          sampleCount: 0,
          cleaningSampleCount: 0,
          batterySum: 0,
          batteryCount: 0,
          minBattery: Infinity,
          maxBattery: -Infinity,
          binFullSampleCount: 0,
          binFullEvents: 0,
          missionsStarted: 0,
          estimatedCleaningMs: 0,
          estimatedTotalMs: 0
        });
      }
      return buckets.get(bucketStart);
    };

    let prevBinFull = null;
    let prevPhase = null;

    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i];
      const bucketStart = Math.floor(row.timestamp / bucketSizeMs) * bucketSizeMs;
      const bucket = ensureBucket(bucketStart);

      bucket.sampleCount += 1;
      if (row.cleaning) bucket.cleaningSampleCount += 1;
      if (row.bin_full === 1) bucket.binFullSampleCount += 1;

      if (Number.isFinite(row.battery_pct)) {
        bucket.batterySum += row.battery_pct;
        bucket.batteryCount += 1;
        if (row.battery_pct < bucket.minBattery) bucket.minBattery = row.battery_pct;
        if (row.battery_pct > bucket.maxBattery) bucket.maxBattery = row.battery_pct;
      }

      if (row.bin_full === 1 && prevBinFull === 0) {
        bucket.binFullEvents += 1;
      }
      prevBinFull = row.bin_full === 1 ? 1 : 0;

      const phase = row.phase || null;
      if (phase === 'run' && prevPhase !== 'run') {
        bucket.missionsStarted += 1;
      }
      prevPhase = phase;

      if (i < rows.length - 1) {
        const nextRow = rows[i + 1];
        const interval = clampInterval(nextRow.timestamp - row.timestamp);
        bucket.estimatedTotalMs += interval;
        if (row.cleaning) {
          bucket.estimatedCleaningMs += interval;
        }
      }
    }

    const normalizedBuckets = Array.from(buckets.values())
      .sort((a, b) => a.start - b.start)
      .map((bucket) => ({
        start: bucket.start,
        end: bucket.end,
        sampleCount: bucket.sampleCount,
        cleaningSampleCount: bucket.cleaningSampleCount,
        estimatedCleaningMs: bucket.estimatedCleaningMs,
        estimatedTotalMs: bucket.estimatedTotalMs,
        averageBatteryPct: bucket.batteryCount ? bucket.batterySum / bucket.batteryCount : null,
        minBatteryPct: bucket.batteryCount ? bucket.minBattery : null,
        maxBatteryPct: bucket.batteryCount ? bucket.maxBattery : null,
        binFullSampleCount: bucket.binFullSampleCount,
        binFullEvents: bucket.binFullEvents,
        missionsStarted: bucket.missionsStarted
      }));

    const rangeStart = normalizedBuckets.length ? normalizedBuckets[0].start : null;
    const rangeEnd = normalizedBuckets.length ? normalizedBuckets[normalizedBuckets.length - 1].end : null;

    return {
      rangeMs,
      bucketSizeMs,
      rangeStart,
      rangeEnd,
      buckets: normalizedBuckets
    };
  }

  _suggestBucketSize(rangeMs) {
    if (!Number.isFinite(rangeMs)) {
      return DAY_MS;
    }

    if (rangeMs <= 2 * DAY_MS) {
      return 60 * 60 * 1000; // 1 hour buckets
    }
    if (rangeMs <= 14 * DAY_MS) {
      return 6 * 60 * 60 * 1000; // 6 hour buckets
    }
    if (rangeMs <= 60 * DAY_MS) {
      return DAY_MS;
    }
    return 7 * DAY_MS; // weekly buckets for very long ranges
  }

  getMissionMap(options = {}) {
    const requestedMissionId = options.missionId || null;
    const maxPointsRaw = options.maxPoints;
    const maxPoints = Number.isFinite(maxPointsRaw) && maxPointsRaw > 0
      ? Math.min(Math.floor(maxPointsRaw), MAX_MAP_POINTS)
      : DEFAULT_MAP_MAX_POINTS;

    const missionBounds = requestedMissionId
      ? this.statements.selectMissionBounds.get({ missionId: requestedMissionId })
      : null;

    let missionId = missionBounds && missionBounds.missionId ? missionBounds.missionId : null;
    let boundsRow = missionBounds || null;

    if (!missionId) {
      const latest = this.statements.selectLatestMission.get();
      if (!latest || !latest.missionId) {
        return null;
      }
      missionId = latest.missionId;
      boundsRow = latest;
    }

    const rows = this.statements.selectMissionPath.all({ missionId });
    if (!rows || rows.length === 0) {
      return {
        missionId,
        startedAt: boundsRow ? boundsRow.startedAt || null : null,
        endedAt: boundsRow ? boundsRow.endedAt || null : null,
        sampleCount: 0,
        pointCount: 0,
        bounds: null,
        mission: this._getMissionDetails(missionId),
        points: []
      };
    }

    const samples = rows.filter((row) => Number.isFinite(row.x) && Number.isFinite(row.y));

    if (!samples.length) {
      return {
        missionId,
        startedAt: boundsRow ? boundsRow.startedAt || null : null,
        endedAt: boundsRow ? boundsRow.endedAt || null : null,
        sampleCount: rows.length,
        pointCount: 0,
        bounds: null,
        mission: this._getMissionDetails(missionId),
        points: []
      };
    }

    const downsampled = this._downsample(samples, maxPoints);

    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;

    downsampled.forEach((point) => {
      if (point.x < minX) minX = point.x;
      if (point.x > maxX) maxX = point.x;
      if (point.y < minY) minY = point.y;
      if (point.y > maxY) maxY = point.y;
    });

    const startedAt = boundsRow && boundsRow.startedAt ? boundsRow.startedAt : downsampled[0].timestamp || null;
    const endedAt = boundsRow && boundsRow.endedAt ? boundsRow.endedAt : downsampled[downsampled.length - 1].timestamp || null;

    return {
      missionId,
      startedAt,
      endedAt,
      sampleCount: rows.length,
      pointCount: downsampled.length,
      bounds: {
        minX,
        maxX,
        minY,
        maxY
      },
      mission: this._getMissionDetails(missionId),
      points: downsampled.map((point) => ({
        timestamp: point.timestamp,
        x: point.x,
        y: point.y,
        theta: Number.isFinite(point.theta) ? point.theta : null
      }))
    };
  }

  _downsample(points, maxPoints) {
    if (!Array.isArray(points) || points.length <= maxPoints) {
      return points.slice();
    }

    const stride = Math.ceil(points.length / maxPoints);
    const sampled = [];
    for (let i = 0; i < points.length; i += stride) {
      sampled.push(points[i]);
    }

    const lastPoint = points[points.length - 1];
    if (sampled[sampled.length - 1] !== lastPoint) {
      sampled.push(lastPoint);
    }

    return sampled;
  }

  _getMissionDetails(missionId) {
    if (!missionId) {
      return null;
    }

    try {
      const row = this.statements.selectMissionDetails.get({ missionId });
      if (row && row.missionJson) {
        return JSON.parse(row.missionJson);
      }
    } catch (error) {
      if (process.env.LOG_LEVEL && process.env.LOG_LEVEL.toLowerCase() === 'debug') {
        console.error('Failed to parse mission details:', error);
      }
    }

    return null;
  }
}

module.exports = AnalyticsStore;
module.exports.deriveMissionIdentifier = deriveMissionIdentifier;
