const fs = require('fs');
const path = require('path');

/**
 * Simple one-shot scheduler with JSON persistence.
 * Emits WS notifications via provided broadcast() and records audit via addAudit().
 */
class Scheduler {
  constructor(options) {
    this.storagePath = options.storagePath || path.join(process.cwd(), 'var', 'schedules.json');
    this.broadcast = options.broadcast || (() => {});
    this.addAudit = options.addAudit || (() => {});
    this.log = options.log || (() => {});
    this.execute = options.execute; // async (schedule, execReqId) => {}

    this.schedules = [];
    this._timer = null;
    this._disposed = false;

    this._ensureDir();
    this._load();
    this._scheduleNext();
  }

  _ensureDir() {
    try {
      const dir = path.dirname(this.storagePath);
      fs.mkdirSync(dir, { recursive: true });
    } catch (e) {
      // ignore
    }
  }

  _load() {
    try {
      if (fs.existsSync(this.storagePath)) {
        const data = JSON.parse(fs.readFileSync(this.storagePath, 'utf8'));
        if (Array.isArray(data)) {
          this.schedules = data;
        }
      }
    } catch (e) {
      this.log('error', 'Failed to load schedules:', e.message);
      this.schedules = [];
    }
  }

  _save() {
    try {
      fs.writeFileSync(this.storagePath, JSON.stringify(this.schedules, null, 2), 'utf8');
    } catch (e) {
      this.log('error', 'Failed to persist schedules:', e.message);
    }
  }

  _now() {
    return Date.now();
  }

  _genId() {
    return Math.random().toString(16).slice(2) + Math.random().toString(16).slice(2);
  }

  list() {
    return this.schedules.slice().sort((a, b) => a.scheduledAt - b.scheduledAt);
  }

  create({ scheduledAt, action, payload, requestId }) {
    const now = this._now();
    const schedule = {
      id: this._genId(),
      action,
      payload: payload || null,
      scheduledAt,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
      requestId: requestId || null,
      intervalMs: null,
      lastRunAt: null
    };
    this.schedules.push(schedule);
    this._save();
    this.broadcast({ type: 'schedule', event: 'created', schedule: this._public(schedule) });
    this._scheduleNext();
    return schedule;
  }

  get(id) {
    return this.schedules.find(s => s.id === id) || null;
  }

  cancel(id) {
    const s = this.get(id);
    if (!s) return null;
    if (s.status !== 'pending') return s; // not cancellable but return it
    s.status = 'canceled';
    s.updatedAt = this._now();
    this._save();
    this.broadcast({ type: 'schedule', event: 'canceled', schedule: this._public(s) });
    this._scheduleNext();
    return s;
  }

  update(id, changes = {}) {
    const s = this.get(id);
    if (!s) return null;
    if (s.status !== 'pending') return s; // allow only pending updates
    let touched = false;
    if (typeof changes.scheduledAt === 'number' && Number.isFinite(changes.scheduledAt)) {
      s.scheduledAt = changes.scheduledAt; touched = true;
    }
    if (typeof changes.action === 'string' && changes.action) {
      s.action = changes.action; touched = true;
    }
    if (changes.payload !== undefined) {
      s.payload = changes.payload || null; touched = true;
    }
    if (changes.intervalMs !== undefined) {
      const iv = Number(changes.intervalMs);
      s.intervalMs = Number.isFinite(iv) && iv > 0 ? iv : null; touched = true;
    }
    if (touched) {
      s.updatedAt = this._now();
      this._save();
      this.broadcast({ type: 'schedule', event: 'updated', schedule: this._public(s) });
      this._scheduleNext();
    }
    return s;
  }

  _scheduleNext() {
    if (this._disposed) return;
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
    const now = this._now();
    const next = this.schedules
      .filter(s => s.status === 'pending')
      .sort((a, b) => a.scheduledAt - b.scheduledAt)[0];
    if (!next) return; // nothing to do
    const delay = Math.max(0, next.scheduledAt - now);
    // Cap delay to 2^31-1 for setTimeout (approximately 24.8 days)
    const capped = Math.min(delay, 0x7fffffff);
    this._timer = setTimeout(() => this._onTimer(), capped);
  }

  async _onTimer() {
    if (this._disposed) return;
    // Find all due tasks (in case of long pause)
    const now = this._now();
    const due = this.schedules
      .filter(s => s.status === 'pending' && s.scheduledAt <= now)
      .sort((a, b) => a.scheduledAt - b.scheduledAt);
    for (const s of due) {
      if (this._disposed) return;
      await this._executeOne(s);
    }
    this._scheduleNext();
  }

  _public(schedule) {
    // Return a copy safe for WS/REST
    const { id, action, payload, scheduledAt, status, createdAt, updatedAt, executedAt, requestId, executionRequestId, result, intervalMs, lastRunAt } = schedule;
    return { id, action, payload, scheduledAt, status, createdAt, updatedAt, executedAt, requestId, executionRequestId, result, intervalMs, lastRunAt };
  }

  async _executeOne(s) {
    if (this._disposed) return;
    if (s.status !== 'pending') return; // race guard
    const execReqId = Math.random().toString(16).slice(2);
    try {
      this.broadcast({ type: 'schedule', event: 'executing', schedule: this._public(s) });
      await this.execute(s, execReqId);
      const now = this._now();
      s.lastRunAt = now;
      s.executedAt = now;
      s.executionRequestId = execReqId;
      s.updatedAt = now;
      s.result = { ok: true };
      if (s.intervalMs && Number.isFinite(s.intervalMs) && s.intervalMs > 0) {
        // recurring: reschedule and remain pending
        s.scheduledAt = now + s.intervalMs;
        s.status = 'pending';
      } else {
        s.status = 'executed';
      }
      this._save();
      this.broadcast({ type: 'schedule', event: 'executed', schedule: this._public(s) });
      this.addAudit({ requestId: execReqId, command: `schedule:${s.action}`, status: 'ok', scheduleId: s.id });
    } catch (error) {
      const now = this._now();
      s.executedAt = now;
      s.executionRequestId = execReqId;
      s.updatedAt = now;
      s.result = { ok: false, message: error?.message || String(error) };
      if (s.intervalMs && Number.isFinite(s.intervalMs) && s.intervalMs > 0) {
        // recurring: keep pending and try again on next interval
        s.lastRunAt = now;
        s.scheduledAt = now + s.intervalMs;
        s.status = 'pending';
      } else {
        s.status = 'failed';
      }
      this._save();
      this.broadcast({ type: 'schedule', event: 'failed', schedule: this._public(s) });
      this.addAudit({ requestId: execReqId, command: `schedule:${s.action}`, status: 'error', message: s.result.message, scheduleId: s.id });
    }
  }

  dispose() {
    this._disposed = true;
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
  }
}

module.exports = Scheduler;
