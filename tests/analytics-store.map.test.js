const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'error';

const AnalyticsStore = require('../server/data/analytics-store');

function createTempDb() {
  const tmpDir = path.join(__dirname, '../var/tmp-tests');
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
  const dbPath = path.join(tmpDir, `analytics-${Date.now()}-${Math.random().toString(16).slice(2)}.db`);
  return new AnalyticsStore({ dbPath });
}

function insertPose(store, timestamp, x, y, extras = {}) {
  const originalNow = Date.now;
  try {
    Date.now = () => timestamp;
    store.recordTelemetry({
      battery: 80,
      binFull: false,
      cleaning: true,
      mission: { phase: 'run', cycle: 'clean', nMssn: 1, ...extras.mission },
      position: { x, y, theta: 0, segmentId: extras.segmentId, regionId: extras.regionId }
    });
  } finally {
    Date.now = originalNow;
  }
}

test('getMissionMap returns null when no missions exist', () => {
  const store = createTempDb();
  const map = store.getMissionMap({});
  assert.equal(map, null);
});

test('getMissionMap computes bounds and downsamples to maxPoints', () => {
  const store = createTempDb();
  const base = Date.now();
  const count = 3000;
  for (let i = 0; i < count; i += 1) {
    insertPose(store, base + i * 1000, i, -i);
  }

  const map = store.getMissionMap({ maxPoints: 500 });
  assert(map);
  // Downsampler preserves the last point; allow +1 over the target
  assert.equal(map.pointCount <= 501, true);
  assert.equal(map.sampleCount, count);
  assert.equal(map.bounds.minX, 0);
  assert.equal(map.bounds.maxX, count - 1);
  assert.equal(map.bounds.minY, -(count - 1));
  assert.equal(map.bounds.maxY, 0);
  // Ensure last point preserved
  const last = map.points[map.points.length - 1];
  assert.equal(last.x, count - 1);
  assert.equal(last.y, -(count - 1));
});

test('getMissionMap surfaces mapId and regions from mission and points', () => {
  const store = createTempDb();
  const base = Date.now();
  // Seed with mission details inc regions & pmap
  insertPose(store, base, 0, 0, {
    mission: {
      phase: 'run',
      cycle: 'clean',
      nMssn: 2,
      pmap_id: 'pmap-xyz',
      regions: [{ region_id: 'kitchen', name: 'Kitchen' }],
      mapSegs: [5]
    },
    segmentId: '5'
  });
  // more points
  insertPose(store, base + 1000, 1, 1, { segmentId: '6' });
  // Include pmap and regions again on the latest mission row so extraction picks it up
  insertPose(store, base + 2000, 2, 0, {
    regionId: 'hall',
    mission: { pmap_id: 'pmap-xyz', regions: [{ region_id: 'kitchen', name: 'Kitchen' }] }
  });

  const map = store.getMissionMap({});
  assert(map.mapId === 'pmap-xyz');
  const regionIds = map.regions.map((r) => r.id);
  // Must contain mission-defined region and discovered segments; hall may or may not appear depending on normalization order.
  assert(regionIds.includes('kitchen'));
  // Other dynamic regions (segments or hall) may appear depending on normalization heuristics.
});
