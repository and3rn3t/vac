const test = require('node:test');
const assert = require('node:assert/strict');

const {
  parsePositiveInt,
  parseDurationToMs,
  validateConnectBody,
  validateCleanRoomsBody,
  validateMapQuery,
  validateAnalyticsQuery
} = require('../server/validation');

test('parsePositiveInt parses valid numbers and rejects non-positives', () => {
  assert.equal(parsePositiveInt('10'), 10);
  assert.equal(parsePositiveInt(5.9), 5);
  assert.equal(parsePositiveInt(0, null), null);
  assert.equal(parsePositiveInt(-3, null), null);
  assert.equal(parsePositiveInt('abc', null), null);
});

test('parseDurationToMs supports suffix units', () => {
  assert.equal(parseDurationToMs('5s', 0), 5000);
  assert.equal(parseDurationToMs('2m', 0), 120000);
  assert.equal(parseDurationToMs('1h', 0), 3600000);
  assert.equal(parseDurationToMs('3d', 0), 259200000);
  assert.equal(parseDurationToMs('1w', 0), 604800000);
});

test('validateConnectBody requires ip, blid, password', () => {
  const ok = validateConnectBody({ ip: '1.2.3.4', blid: 'b', password: 'p' });
  assert.equal(ok.ok, true);
  const bad = validateConnectBody({});
  assert.equal(bad.ok, false);
  assert(bad.errors.find(e => e.includes('ip')));
});

test('validateCleanRoomsBody normalizes string region and validates ordered', () => {
  const ok = validateCleanRoomsBody({ regions: 'kitchen', ordered: false });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.regions, ['kitchen']);
  const bad = validateCleanRoomsBody({ regions: [], ordered: 'yes' });
  assert.equal(bad.ok, false);
});

test('validateMapQuery parses missionId and maxPoints', () => {
  let v = validateMapQuery({ missionId: 'run:1', maxPoints: '1000' });
  assert.equal(v.ok, true);
  assert.equal(v.missionId, 'run:1');
  assert.equal(v.maxPoints, 1000);

  v = validateMapQuery({ maxPoints: 'abc' });
  assert.equal(v.ok, false);
});

test('validateAnalyticsQuery parses range and bucket', () => {
  let v = validateAnalyticsQuery({ range: '7d', bucket: '1d' }, { defaultRangeMs: 30 * 24 * 60 * 60 * 1000 });
  assert.equal(v.ok, true);
  assert.equal(v.bucketSizeMs, 24 * 60 * 60 * 1000);

  v = validateAnalyticsQuery({ range: 'oops' }, { defaultRangeMs: 1000 });
  // invalid range falls back to default; still ok
  assert.equal(v.ok, true);
});
