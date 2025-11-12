import { BaseComponent } from './BaseComponent.js';

// Provides a simple analytics dashboard: summary metrics and a tiny bar chart using canvas.
export class AnalyticsComponent extends BaseComponent {
  constructor(opts = {}) {
    super(opts);
    this.summaryEl = null;
    this.canvas = null;
    this.ctx = null;
    this.range = opts.range || '30d';
    this.bucket = opts.bucket || '1d';
    this._ticker = null;
  }

  bind() {
    const host = this.el || document.getElementById(this.opts.id);
    if (!host) return;
    host.innerHTML = '';
    const header = document.createElement('div');
    header.className = 'analytics-header';
    const title = document.createElement('h3');
    title.textContent = 'Analytics';
    const controls = document.createElement('div');
    controls.className = 'analytics-controls';
    const rangeSel = document.createElement('select');
    rangeSel.innerHTML = `
      <option value="7d">7 days</option>
      <option value="30d" selected>30 days</option>
      <option value="90d">90 days</option>
    `;
    rangeSel.value = this.range;
    rangeSel.addEventListener('change', () => { this.range = rangeSel.value; this.refresh(); });
    const bucketSel = document.createElement('select');
    bucketSel.innerHTML = `
      <option value="6h">6 hours</option>
      <option value="12h">12 hours</option>
      <option value="1d" selected>1 day</option>
      <option value="7d">1 week</option>
    `;
    bucketSel.value = this.bucket;
    bucketSel.addEventListener('change', () => { this.bucket = bucketSel.value; this.refresh(); });
    controls.appendChild(rangeSel);
    controls.appendChild(bucketSel);
    header.appendChild(title);
    header.appendChild(controls);

    const grid = document.createElement('div');
    grid.className = 'analytics-grid';
    this.summaryEl = document.createElement('div');
    this.summaryEl.className = 'analytics-summary';
    const chartWrap = document.createElement('div');
    chartWrap.className = 'analytics-chart-wrap';
    this.canvas = document.createElement('canvas');
    this.canvas.width = 600; this.canvas.height = 160;
    this.ctx = this.canvas.getContext('2d');
    chartWrap.appendChild(this.canvas);

    host.appendChild(header);
    host.appendChild(grid);
    grid.appendChild(this.summaryEl);
    grid.appendChild(chartWrap);

    this.refresh();
  }

  async refresh() {
    try {
      const [summary, history] = await Promise.all([
        this.fetchJson(`/api/analytics/summary?range=${encodeURIComponent(this.range)}`),
        this.fetchJson(`/api/analytics/history?range=${encodeURIComponent(this.range)}&bucket=${encodeURIComponent(this.bucket)}`)
      ]);
      this.renderSummary(summary);
      this.renderChart(history);
    } catch (e) {
      window.VacEventBus.emit('log', { type: 'error', message: `Analytics load failed: ${e.message}` });
    }
  }

  async fetchJson(url) {
    const res = await fetch(url);
    if (!res.ok) {
      let msg = `${res.status}`;
      try { const j = await res.json(); if (j && j.error) msg = j.error; } catch (_) {}
      throw new Error(msg);
    }
    return res.json();
  }

  renderSummary(s) {
    if (!this.summaryEl) return;
    if (!s || typeof s !== 'object') { this.summaryEl.textContent = 'No analytics available.'; return; }
    const fmtDur = (ms) => {
      if (!Number.isFinite(ms) || ms <= 0) return '0m';
      const m = Math.floor(ms / 60000);
      if (m >= 60) { const h = Math.floor(m / 60); const mm = m % 60; return `${h}h ${mm}m`; }
      return `${m}m`;
    };
    this.summaryEl.innerHTML = `
      <div class="analytics-cards">
        <div class="card"><div class="label">Cleaning Time</div><div class="value">${fmtDur(s.estimatedCleaningMs)}</div></div>
        <div class="card"><div class="label">Total Runtime</div><div class="value">${fmtDur(s.estimatedTotalMs)}</div></div>
        <div class="card"><div class="label">Avg Battery</div><div class="value">${Math.round(s.averageBatteryPct ?? 0)}%</div></div>
        <div class="card"><div class="label">Bin Full</div><div class="value">${s.binFullEvents ?? 0}</div></div>
        <div class="card"><div class="label">Missions</div><div class="value">${s.missionsStarted ?? 0}</div></div>
      </div>
    `;
  }

  renderChart(h) {
    const ctx = this.ctx; if (!ctx) return;
    ctx.clearRect(0,0,this.canvas.width,this.canvas.height);
    ctx.fillStyle = '#0f141a'; ctx.fillRect(0,0,this.canvas.width,this.canvas.height);
    if (!h || !Array.isArray(h.buckets) || !h.buckets.length) {
      ctx.fillStyle = '#94a3b8';
      ctx.fillText('No history data', 12, 24);
      return;
    }
    const values = h.buckets.map(b => b.estimatedCleaningMs || 0);
    const max = Math.max(...values, 1);
    const w = this.canvas.width; const hgt = this.canvas.height; const pad = 12; const gap = 4;
    const barCount = values.length;
    const barWidth = Math.max(2, Math.floor((w - pad*2 - gap*(barCount-1)) / barCount));
    values.forEach((v, i) => {
      const x = pad + i*(barWidth+gap);
      const hVal = Math.round((v / max) * (hgt - pad*2));
      const y = hgt - pad - hVal;
      ctx.fillStyle = '#39ff14';
      ctx.fillRect(x, y, barWidth, hVal);
    });
    // axes
    ctx.strokeStyle = '#273144';
    ctx.beginPath(); ctx.moveTo(pad, pad); ctx.lineTo(pad, hgt-pad); ctx.lineTo(w-pad, hgt-pad); ctx.stroke();
  }
}
