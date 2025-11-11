const test = require('node:test');
const assert = require('node:assert/strict');

process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'error';

const RoombaClient = require('../server/roomba-client');

function createClient() {
  const client = new RoombaClient({
    ip: '127.0.0.1',
    blid: 'fake',
    password: 'fake'
  });
  client.connected = true;
  client.robotState.mapId = 'map-state-001';
  client.robotState.userPmapvId = 'user-map-abc';
  return client;
}

test('cleanRooms dispatches start command with normalized payload', async () => {
  const client = createClient();
  const requestedRegions = [{ region_id: 'kitchen' }, 'hallway'];

  const captured = {};
  client.sendCommand = async (command, payload) => {
    captured.command = command;
    captured.payload = payload;
  };

  await client.cleanRooms({ regions: requestedRegions, ordered: false });

  assert.equal(captured.command, 'start');
  assert.equal(captured.payload.ordered, 0);
  assert.deepEqual(captured.payload.regions, [
    { region_id: 'kitchen', type: 'rid' },
    { region_id: 'hallway', type: 'rid' }
  ]);
  assert.equal(captured.payload.pmap_id, 'map-state-001');
  assert.equal(captured.payload.user_pmapv_id, 'user-map-abc');
});

test('cleanRooms prefers explicit mapId and preserves order flag', async () => {
  const client = createClient();
  const captured = {};
  client.sendCommand = async (command, payload) => {
    captured.command = command;
    captured.payload = payload;
  };

  await client.cleanRooms({
    regions: ['5'],
    mapId: 'explicit-map',
    ordered: true
  });

  assert.equal(captured.payload.pmap_id, 'explicit-map');
  assert.equal(captured.payload.ordered, 1);
});

test('cleanRooms rejects when no usable regions remain', async () => {
  const client = createClient();
  client.sendCommand = async () => {
    throw new Error('sendCommand should not be called');
  };

  await assert.rejects(() => client.cleanRooms({ regions: [null, undefined] }), {
    message: 'At least one valid region is required'
  });
});
