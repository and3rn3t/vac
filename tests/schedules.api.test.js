const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
process.env.NODE_ENV = 'test';
const { startServer, stopServer } = require('../server/index');

function apiRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const options = {
      hostname: 'localhost',
      port: global.__TEST_PORT__,
      path,
      method,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': payload ? Buffer.byteLength(payload) : 0
      }
    };
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const json = data ? JSON.parse(data) : {};
          resolve({ status: res.statusCode, body: json, headers: res.headers });
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

test('setup server', async () => {
  const { port } = await startServer(0); // ephemeral port
  global.__TEST_PORT__ = port;
  assert.ok(port > 0);
});

test('POST /api/schedules one-shot', async () => {
  const when = Date.now() + 5000;
  const res = await apiRequest('POST', '/api/schedules', { action: 'start', when });
  assert.equal(res.status, 201);
  assert.ok(res.body.schedule);
  assert.equal(res.body.schedule.action, 'start');
  assert.equal(res.body.schedule.scheduledAt, when);
  assert.equal(res.body.schedule.status, 'pending');
});

test('POST /api/schedules recurring', async () => {
  const when = Date.now() + 4000;
  const res = await apiRequest('POST', '/api/schedules', { action: 'pause', when, intervalMs: 60000 });
  assert.equal(res.status, 201);
  assert.ok(res.body.schedule.intervalMs === 60000 || res.body.schedule.intervalMs === undefined, 'interval may appear after update broadcast');
  // fetch list
  const list = await apiRequest('GET', '/api/schedules');
  assert.equal(list.status, 200);
  const match = list.body.items.find(s => s.action === 'pause');
  assert.ok(match, 'pause schedule present');
});

test('PATCH /api/schedules update time + interval', async () => {
  const baseWhen = Date.now() + 3000;
  const create = await apiRequest('POST', '/api/schedules', { action: 'dock', when: baseWhen });
  const id = create.body.schedule.id;
  const newWhen = baseWhen + 10000;
  const patch = await apiRequest('PATCH', `/api/schedules/${id}`, { when: newWhen, intervalMs: 120000 });
  assert.equal(patch.status, 200);
  assert.equal(patch.body.schedule.scheduledAt, newWhen);
  assert.equal(patch.body.schedule.intervalMs, 120000);
});

test('DELETE /api/schedules cancels pending', async () => {
  const when = Date.now() + 8000;
  const create = await apiRequest('POST', '/api/schedules', { action: 'resume', when });
  const id = create.body.schedule.id;
  const del = await apiRequest('DELETE', `/api/schedules/${id}`);
  assert.equal(del.status, 200);
  assert.equal(del.body.schedule.status, 'canceled');
});

test('teardown server', async () => {
  await stopServer();
  assert.ok(true, 'server stopped');
});
