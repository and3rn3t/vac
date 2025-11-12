const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const Scheduler = require('../server/scheduler');

function tempPath(name) {
  const p = path.join(__dirname, `../var/${name}.json`);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  try { fs.unlinkSync(p); } catch (_) {}
  return p;
}

async function waitUntil(predicate, { timeoutMs = 2000, intervalMs = 25 } = {}) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      try {
        if (predicate()) return resolve(true);
      } catch (e) { return reject(e); }
      if (Date.now() - start > timeoutMs) return reject(new Error('timeout'));
      setTimeout(tick, intervalMs);
    };
    tick();
  });
}

test('recurring schedule executes multiple times and remains pending', async () => {
  const storage = tempPath('recurring-success');
  const events = [];
  const audit = [];
  let runs = 0;
  const scheduler = new Scheduler({
    storagePath: storage,
    broadcast: (e) => events.push(e),
    addAudit: (a) => audit.push(a),
    log: () => {},
    execute: async () => { runs += 1; }
  });
  const firstAt = Date.now() + 50; // initial trigger
  const s = scheduler.create({ scheduledAt: firstAt, action: 'start', requestId: 'req-r1' });
  scheduler.update(s.id, { intervalMs: 100 });

  await waitUntil(() => runs >= 2, { timeoutMs: 3000 });
  const updated = scheduler.get(s.id);
  assert.equal(updated.status, 'pending', 'recurring schedule stays pending');
  assert.ok(updated.lastRunAt, 'lastRunAt set');
  assert.ok(updated.scheduledAt > updated.lastRunAt, 'rescheduled after last run');
  const execEvents = events.filter(ev => ev.type === 'schedule' && ev.event === 'executed');
  assert.ok(execEvents.length >= 2, 'multiple executed events');
  const auditEntries = audit.filter(a => a.command === 'schedule:start' && a.status === 'ok');
  assert.ok(auditEntries.length >= 2, 'audit entries for each run');
  scheduler.dispose();
});

test('recurring schedule retries after failure', async () => {
  const storage = tempPath('recurring-failure-retry');
  const events = [];
  let runs = 0;
  const scheduler = new Scheduler({
    storagePath: storage,
    broadcast: (e) => events.push(e),
    addAudit: () => {},
    log: () => {},
    execute: async () => {
      runs += 1;
      if (runs % 2 === 1) throw new Error('simulated error');
    }
  });
  const firstAt = Date.now() + 40;
  const s = scheduler.create({ scheduledAt: firstAt, action: 'dock', requestId: 'req-r2' });
  scheduler.update(s.id, { intervalMs: 80 });
  await waitUntil(() => runs >= 3, { timeoutMs: 4000 });
  const failEvents = events.filter(e => e.type === 'schedule' && e.event === 'failed');
  const execEvents = events.filter(e => e.type === 'schedule' && e.event === 'executed');
  assert.ok(failEvents.length >= 1, 'at least one failed event');
  assert.ok(execEvents.length >= 1, 'at least one executed event after failure');
  const sched = scheduler.get(s.id);
  assert.equal(sched.status, 'pending', 'still pending after mixed results');
  scheduler.dispose();
});

test('schedule update emits updated event and changes scheduledAt', () => {
  const storage = tempPath('recurring-update');
  const events = [];
  const scheduler = new Scheduler({
    storagePath: storage,
    broadcast: (e) => events.push(e),
    addAudit: () => {},
    log: () => {},
    execute: async () => {}
  });
  const at = Date.now() + 5000;
  const s = scheduler.create({ scheduledAt: at, action: 'pause', requestId: 'req-r3' });
  const later = at + 10000;
  scheduler.update(s.id, { scheduledAt: later, intervalMs: 60000 });
  const updatedEvent = events.find(e => e.type === 'schedule' && e.event === 'updated');
  assert.ok(updatedEvent, 'updated event broadcast');
  const sched = scheduler.get(s.id);
  assert.equal(sched.scheduledAt, later, 'scheduledAt updated');
  assert.equal(sched.intervalMs, 60000, 'intervalMs set');
  scheduler.dispose();
});
