const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const Scheduler = require('../server/scheduler');

function tempSchedulePath(name) {
  const p = path.join(__dirname, `../var/${name}.json`);
  // ensure dir exists
  fs.mkdirSync(path.dirname(p), { recursive: true });
  try { fs.unlinkSync(p); } catch (_) {}
  return p;
}

async function waitFor(predicate, timeoutMs = 2000, intervalMs = 20) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      try {
        if (predicate()) return resolve(true);
      } catch (e) {
        return reject(e);
      }
      if (Date.now() - start > timeoutMs) return reject(new Error('timeout'));
      setTimeout(tick, intervalMs);
    };
    tick();
  });
}

test('scheduler creates and lists pending schedules', async () => {
  const storagePath = tempSchedulePath('sched-create-list');
  const events = [];
  const audit = [];
  const scheduler = new Scheduler({
    storagePath,
    broadcast: (e) => events.push(e),
    addAudit: (a) => audit.push(a),
    log: () => {},
    execute: async () => {}
  });

  const future = Date.now() + 1000;
  const s = scheduler.create({ scheduledAt: future, action: 'start', requestId: 'req1' });
  assert.ok(s.id, 'created schedule has id');
  assert.equal(s.status, 'pending');

  const list = scheduler.list();
  assert.equal(list.length, 1);
  assert.equal(list[0].id, s.id);

  // persisted
  const raw = JSON.parse(fs.readFileSync(storagePath, 'utf8'));
  assert.equal(raw.length, 1);
  scheduler.dispose();
});

test('scheduler executes action on time and records audit', async () => {
  const storagePath = tempSchedulePath('sched-exec');
  const events = [];
  const audit = [];
  let executed = 0;
  const scheduler = new Scheduler({
    storagePath,
    broadcast: (e) => events.push(e),
    addAudit: (a) => audit.push(a),
    log: () => {},
    execute: async () => { executed += 1; }
  });

  const soon = Date.now() + 50;
  const s = scheduler.create({ scheduledAt: soon, action: 'start', requestId: 'req2' });

  await waitFor(() => executed === 1, 3000);

  const after = scheduler.get(s.id);
  assert.equal(after.status, 'executed');
  assert.ok(after.executedAt);

  // WS events include executing and executed
  const types = events.filter(e => e && e.type === 'schedule').map(e => e.event);
  assert.ok(types.includes('executing'));
  assert.ok(types.includes('executed'));

  // Audit recorded
  assert.ok(audit.find(a => a && a.command === 'schedule:start' && a.status === 'ok'));
  scheduler.dispose();
});

test('scheduler cancels pending schedule', async () => {
  const storagePath = tempSchedulePath('sched-cancel');
  const events = [];
  const scheduler = new Scheduler({
    storagePath,
    broadcast: (e) => events.push(e),
    addAudit: () => {},
    log: () => {},
    execute: async () => {}
  });

  const later = Date.now() + 5_000; // far enough to cancel
  const s = scheduler.create({ scheduledAt: later, action: 'dock', requestId: 'req3' });
  const canceled = scheduler.cancel(s.id);
  assert.equal(canceled.status, 'canceled');

  // Ensure it stays canceled
  await new Promise(r => setTimeout(r, 80));
  assert.equal(scheduler.get(s.id).status, 'canceled');

  // WS cancel event
  const canceledEvent = events.find(e => e && e.type === 'schedule' && e.event === 'canceled');
  assert.ok(canceledEvent);
  scheduler.dispose();
});
