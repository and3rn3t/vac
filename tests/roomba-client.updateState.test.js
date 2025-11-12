const test = require('node:test');
const assert = require('node:assert/strict');

process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'error';

const RoombaClient = require('../server/roomba-client');

function createClient() {
  const client = new RoombaClient({ ip: '127.0.0.1', blid: 'fake', password: 'fake' });
  client.connected = true;
  return client;
}

test('updateState sets battery, cleaning flag and mission', () => {
  const client = createClient();

  client.updateState({
    batPct: 73,
    cleanMissionStatus: { phase: 'run', cycle: 'clean', nMssn: 5 }
  });

  const state = client.getState();
  assert.equal(state.battery, 73);
  assert.equal(state.cleaning, true);
  assert.ok(state.mission);
  assert.equal(state.mission.phase, 'run');
});

test('updateState tracks mapId and userPmapvId from mission and lastCommand', () => {
  const client = createClient();

  client.updateState({
    cleanMissionStatus: { phase: 'run', pmap_id: 'pmap-alpha', user_pmapv_id: 'user-1' },
    lastCommand: { pmap_id: 'pmap-beta', user_pmapv_id: 'user-2' }
  });

  let state = client.getState();
  // lastCommand should override when present in updateState path
  assert.equal(state.mapId, 'pmap-beta');
  assert.equal(state.userPmapvId, 'user-2');

  // New update where only mission provides details should preserve/respect values
  client.updateState({ cleanMissionStatus: { phase: 'run', pmapId: 'pmap-gamma' } });
  state = client.getState();
  assert.equal(state.mapId, 'pmap-gamma');
});

test('updateState normalizes segments and regions from mission', () => {
  const client = createClient();

  client.updateState({
    cleanMissionStatus: {
      phase: 'run',
      regions: [{ region_id: 'kitchen' }, { regionId: 'hall' }],
      mapSegs: [1, '2', 3]
    }
  });

  const state = client.getState();
  // updateState preserves provided keys; regionId is not rewritten to region_id
  assert.deepEqual(state.regions, [{ region_id: 'kitchen' }, { regionId: 'hall' }]);
  assert.deepEqual(state.segments, ['1', '2', '3']);
});

test('updateState resolves pose with fallbacks and coerces ids to string', () => {
  const client = createClient();

  client.updateState({
    cleanMissionStatus: { phase: 'run', mapSegs: [7] },
    pose: {
      point: { x: 10.4, y: -2.1 },
      theta: 45,
      seg: 7,
      regionId: 9
    }
  });

  const state = client.getState();
  assert.equal(state.position.x, 10.4);
  assert.equal(state.position.y, -2.1);
  assert.equal(state.position.theta, 45);
  assert.equal(state.position.segmentId, '7');
  assert.equal(state.position.regionId, '9');
});

test('updateState tolerates missing pose fields and uses defaults', () => {
  const client = createClient();

  client.updateState({ cleanMissionStatus: { phase: 'charge' } });
  const state = client.getState();
  assert.equal(state.position.x, 0);
  assert.equal(state.position.y, 0);
  assert.equal(state.position.theta, 0);
});
