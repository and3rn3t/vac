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

function advanceTelemetry(store, samples) {
  // Inject samples with controlled timestamps by monkey-patching Date.now
  const originalNow = Date.now;
  try {
    samples.forEach((sample) => {
      Date.now = () => sample.timestamp;
      store.recordTelemetry(sample.state);
    });
  } finally {
    Date.now = originalNow;
  }
}

test('getSummary returns zeros when no samples present', () => {
  const store = createTempDb();
  const summary = store.getSummary({ rangeMs: 60_000 });
  assert.equal(summary.sampleCount, 0);
  assert.equal(summary.cleaningSampleCount, 0);
  assert.equal(summary.binFullEvents, 0);
  assert.equal(summary.missionsStarted, 0);
});

test('getSummary aggregates cleaning duration, battery stats and events', () => {
  const store = createTempDb();
  const base = Date.now();
  const samples = [
    { timestamp: base + 0, state: { battery: 90, binFull: false, cleaning: false, mission: { phase: 'charge' }, position: { x: 0, y: 0 } } },
    { timestamp: base + 10_000, state: { battery: 88, binFull: false, cleaning: true, mission: { phase: 'run' }, position: { x: 1, y: 1 } } },
    { timestamp: base + 20_000, state: { battery: 86, binFull: true, cleaning: true, mission: { phase: 'run' }, position: { x: 2, y: 1 } } },
    { timestamp: base + 30_000, state: { battery: 84, binFull: true, cleaning: false, mission: { phase: 'stop' }, position: { x: 3, y: 2 } } },
    { timestamp: base + 40_000, state: { battery: 83, binFull: false, cleaning: false, mission: { phase: 'charge' }, position: { x: 3, y: 2 } } }
  ];

  advanceTelemetry(store, samples);

  const summary = store.getSummary({ rangeMs: 120_000 });
  assert.equal(summary.sampleCount, 5);
  assert.equal(summary.cleaningSampleCount, 2); // two samples with cleaning true
  assert.equal(summary.minBatteryPct, 83);
  assert.equal(summary.maxBatteryPct, 90);
  assert(summary.averageBatteryPct >= 80 && summary.averageBatteryPct <= 90);
  assert.equal(summary.binFullEvents, 1); // transition false -> true once
  assert.equal(summary.missionsStarted, 1); // phase run entered once
  assert(summary.estimatedCleaningMs > 0);
  assert(summary.estimatedTotalMs > summary.estimatedCleaningMs);
});

test('getHistory buckets correctly and preserves derived metrics', () => {
  const store = createTempDb();
  const base = Date.now();
  const hour = 60 * 60 * 1000;
  const samples = [];

  // 5 hours of samples, every hour, alternating cleaning state
  for (let i = 0; i < 5; i += 1) {
    samples.push({
      timestamp: base + i * hour,
      state: {
        battery: 50 + i,
        binFull: i === 2, // single bin full event at hour 2
        cleaning: i % 2 === 0,
        mission: { phase: i % 2 === 0 ? 'run' : 'charge' },
        position: { x: i, y: i }
      }
    });
  }

  advanceTelemetry(store, samples);
  const history = store.getHistory({ rangeMs: 6 * hour, bucketSizeMs: hour });

  assert.equal(history.bucketSizeMs, hour);
  assert(history.buckets.length >= 5);

  const cleaningBuckets = history.buckets.filter((b) => b.cleaningSampleCount > 0);
  assert(cleaningBuckets.length >= 3); // hours 0,2,4

  // Bin full events captured in bucket where transition occurs
  const binBucket = history.buckets.find((b) => b.binFullEvents > 0);
  assert(binBucket, 'Expected a bucket with a bin full event');
});
