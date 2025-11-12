import { BaseComponent } from './BaseComponent.js';

// Handles schedule CRUD UI using the existing DOM nodes in index.html
// Delegates network calls directly (fetch) to keep component independent from RoombaApp internals.
export class ScheduleListComponent extends BaseComponent {
    constructor(opts = {}) {
        super(opts);
        // Element references
        this.actionSelect = document.getElementById('scheduleAction');
        this.whenInput = document.getElementById('scheduleWhenInput');
        this.intervalInput = document.getElementById('scheduleIntervalInput');
        this.createBtn = document.getElementById('createScheduleBtn');
        this.refreshBtn = document.getElementById('refreshSchedulesBtn');
        this.listEl = document.getElementById('scheduleList');
        this.filterStatus = document.getElementById('scheduleFilterStatus');
        this.filterAction = document.getElementById('scheduleFilterAction');
        this.sortBtn = document.getElementById('scheduleSortBtn');
        this._all = [];
        this._asc = true; // soonest first
        this._ticker = null;
    }

    bind() {
        if (this.createBtn) this.createBtn.addEventListener('click', () => this.createSchedule());
        if (this.refreshBtn) this.refreshBtn.addEventListener('click', () => this.load());
        if (this.filterStatus) this.filterStatus.addEventListener('change', () => this.applyFilters());
        if (this.filterAction) this.filterAction.addEventListener('change', () => this.applyFilters());
        if (this.sortBtn) this.sortBtn.addEventListener('click', () => this.toggleSort());

        // React to schedule lifecycle
        this.subscribe('scheduleEvent', () => this.loadDebounced());
        this.subscribe('appReady', () => this.load());
        // Restore initial list
        this.load();
    }

    destroy() {
        super.destroy();
        if (this._ticker) clearInterval(this._ticker);
    }

    async load() {
        if (!this.listEl) return;
        try {
            const res = await fetch('/api/schedules');
            const data = await res.json();
            this._all = Array.isArray(data.items) ? data.items : [];
            this.applyFilters();
            this.ensureTicker();
        } catch (err) {
            this.renderMessage(`Failed to load schedules: ${err.message}`);
        }
    }

    loadDebounced() {
        if (this._reloadTimer) clearTimeout(this._reloadTimer);
        this._reloadTimer = setTimeout(() => {
            this._reloadTimer = null;
            this.load();
        }, 250);
    }

    ensureTicker() {
        if (this._ticker) return;
        this._ticker = setInterval(() => {
            if (!this._all.length) return;
            this.applyFilters({ skipSortToggle: true });
        }, 1000);
    }

    toggleSort() {
        this._asc = !this._asc;
        if (this.sortBtn) this.sortBtn.textContent = `Sort: ${this._asc ? 'Soonest' : 'Latest'}`;
        this.applyFilters();
    }

    applyFilters(opts = {}) {
        if (!this.listEl) return;
        let items = [...this._all];
        const status = this.filterStatus ? this.filterStatus.value : '';
        const action = this.filterAction ? this.filterAction.value : '';
        if (status) items = items.filter(s => s.status === status);
        if (action) items = items.filter(s => s.action === action);
        items.sort((a, b) => this._asc ? (a.scheduledAt - b.scheduledAt) : (b.scheduledAt - a.scheduledAt));
        this.renderList(items);
    }

    renderMessage(msg) {
        this.listEl.innerHTML = '';
        const div = document.createElement('div');
        div.className = 'schedule-empty';
        div.textContent = msg;
        this.listEl.appendChild(div);
    }

    renderList(items) {
        const list = this.listEl;
        list.innerHTML = '';
        if (!items.length) {
            this.renderMessage('No schedules yet.');
            return;
        }
        items.forEach(s => list.appendChild(this.renderItem(s)));
    }

    renderItem(s) {
        const el = document.createElement('div');
        el.className = `schedule-item ${s.status}`;
        const title = document.createElement('div');
        title.innerHTML = `<strong>${s.action}</strong> <span class="schedule-status-label ${s.status}">${s.status}</span>`;
        el.appendChild(title);
        const time = document.createElement('div');
        time.className = 'schedule-time';
        const when = s.scheduledAt ? new Date(s.scheduledAt).toLocaleString() : 'n/a';
        const execInfo = s.executedAt ? ` · ran ${new Date(s.executedAt).toLocaleTimeString()}` : '';
        const countdown = this.formatCountdown(s.scheduledAt);
        time.textContent = `At ${when}${execInfo}${countdown ? ` · in ${countdown}` : ''}`;
        el.appendChild(time);
        if (s.payload && s.action === 'cleanRooms' && Array.isArray(s.payload.regions)) {
            const regionsDiv = document.createElement('div');
            regionsDiv.className = 'schedule-time';
            const regionIds = s.payload.regions.map(r => (typeof r === 'object' && r ? (r.region_id || r.regionId || r.id) : r)).filter(Boolean).map(String);
            regionsDiv.textContent = `Regions: ${regionIds.join(', ')}`;
            el.appendChild(regionsDiv);
        }
        if (s.status === 'pending') {
            const actions = document.createElement('div');
            actions.className = 'schedule-actions';
            const cancelBtn = document.createElement('button');
            cancelBtn.type = 'button';
            cancelBtn.className = 'btn btn-danger btn-compact';
            cancelBtn.textContent = 'Cancel';
            cancelBtn.addEventListener('click', () => this.cancelSchedule(s.id));
            actions.appendChild(cancelBtn);
            const editBtn = document.createElement('button');
            editBtn.type = 'button';
            editBtn.className = 'btn btn-secondary btn-compact';
            editBtn.textContent = 'Edit';
            editBtn.addEventListener('click', () => this.editSchedulePrompt(s));
            actions.appendChild(editBtn);
            el.appendChild(actions);
        }
        return el;
    }

    formatCountdown(ts) {
        if (!Number.isFinite(ts)) return '';
        const diff = ts - Date.now();
        if (diff <= 0) return '';
        const sec = Math.floor(diff / 1000);
        const m = Math.floor(sec / 60);
        const s = sec % 60;
        if (m >= 60) {
            const h = Math.floor(m / 60);
            const mm = m % 60;
            return `${h}h ${mm}m`;
        }
        if (m > 0) return `${m}m ${s}s`;
        return `${s}s`;
    }

    parseIntervalInput(value) {
        if (value === undefined || value === null || value === '') return null;
        if (typeof value === 'number') return Number.isFinite(value) ? value : null;
        const str = String(value).trim();
        if (!str) return null;
        if (/^\d+$/.test(str)) return parseInt(str, 10);
        const m = str.match(/^([0-9]+)(ms|s|m|h|d)$/i);
        if (!m) return null;
        const n = parseInt(m[1], 10);
        const unit = m[2].toLowerCase();
        const factors = { ms: 1, s: 1000, m: 60000, h: 3600000, d: 86400000 };
        return n * (factors[unit] || 0);
    }

    parseWhenInput(value) {
        if (!value || typeof value !== 'string') return null;
        const trimmed = value.trim();
        if (!trimmed) return null;
        const durMatch = trimmed.match(/^([0-9]+)(ms|s|m|h|d)$/i);
        if (durMatch) {
            const n = parseInt(durMatch[1], 10);
            const unit = durMatch[2].toLowerCase();
            const factors = { ms: 1, s: 1000, m: 60000, h: 3600000, d: 86400000 };
            return Date.now() + n * (factors[unit] || 0);
        }
        const inMatch = trimmed.match(/^in\s+([0-9]+)(ms|s|m|h|d)$/i);
        if (inMatch) {
            const n = parseInt(inMatch[1], 10);
            const unit = inMatch[2].toLowerCase();
            const factors = { ms: 1, s: 1000, m: 60000, h: 3600000, d: 86400000 };
            return Date.now() + n * (factors[unit] || 0);
        }
        const asDate = new Date(trimmed);
        if (!isNaN(asDate.getTime())) return asDate.getTime();
        return null;
    }

    buildCleanRoomsPayload() {
        // Prefer RoomsComponent selection if available
        const roomsComp = window.vacComponents && window.vacComponents.rooms;
        const app = window.roombaApp;
        let selectedIds = [];
        if (roomsComp && roomsComp.selectedRegionIds && roomsComp.selectedRegionIds.size) {
            selectedIds = Array.from(roomsComp.selectedRegionIds);
        } else if (app && app.selectedRegionIds && app.selectedRegionIds.size) {
            selectedIds = Array.from(app.selectedRegionIds);
        }
        if (!selectedIds.length) return null;
        const regions = selectedIds.map(id => ({ region_id: id }));
        const ordered = roomsComp && roomsComp.orderToggle ? !!roomsComp.orderToggle.checked : (app && app.roomOrderToggle ? !!app.roomOrderToggle.checked : true);
        const payload = { regions, ordered };
        if (app && app.mapData && app.mapData.mapId) payload.mapId = app.mapData.mapId;
        if (app && app.state && app.state.userPmapvId) payload.userPmapvId = app.state.userPmapvId;
        return payload;
    }

    async createSchedule() {
        if (!this.actionSelect || !this.whenInput) return;
        const action = this.actionSelect.value;
        const whenRaw = this.whenInput.value;
        const scheduledAt = this.parseWhenInput(whenRaw);
        if (!scheduledAt) {
            window.VacEventBus.emit('log', { type: 'error', message: 'Invalid schedule time' });
            return;
        }
        const body = { action, when: scheduledAt };
        const iv = this.parseIntervalInput(this.intervalInput ? this.intervalInput.value : '');
        if (iv && Number.isFinite(iv) && iv > 0) body.intervalMs = iv;
        if (action === 'cleanRooms') {
            const payload = this.buildCleanRoomsPayload();
            if (!payload) {
                window.VacEventBus.emit('log', { type: 'error', message: 'Select at least one room first.' });
                return;
            }
            body.payload = payload;
        }
        try {
            this.createBtn.disabled = true;
            const res = await fetch('/api/schedules', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data && data.error ? data.error : `Failed (${res.status})`);
            window.VacEventBus.emit('log', { type: 'success', message: `Schedule created for '${action}'.` });
            this.whenInput.value = '';
            if (this.intervalInput) this.intervalInput.value = '';
            this.load();
        } catch (e) {
            window.VacEventBus.emit('log', { type: 'error', message: `Create schedule failed: ${e.message}` });
        } finally {
            this.createBtn.disabled = false;
        }
    }

    async cancelSchedule(id) {
        if (!id) return;
        try {
            const res = await fetch(`/api/schedules/${id}`, { method: 'DELETE' });
            const data = await res.json();
            if (!res.ok) throw new Error(data && data.error ? data.error : `Failed (${res.status})`);
            window.VacEventBus.emit('log', { type: 'info', message: `Canceled schedule ${id}.` });
            this.load();
        } catch (e) {
            window.VacEventBus.emit('log', { type: 'error', message: `Cancel schedule failed: ${e.message}` });
        }
    }

    async editSchedulePrompt(s) {
        const newWhen = window.prompt('Update time (ISO or relative like 10m):', s.scheduledAt ? new Date(s.scheduledAt).toISOString().slice(0,16) : '');
        if (newWhen === null) return;
        const parsed = this.parseWhenInput(String(newWhen));
        if (!parsed) return window.VacEventBus.emit('log', { type: 'error', message: 'Invalid time input.' });
        let intervalStr = '';
        if (s.intervalMs && Number.isFinite(s.intervalMs)) intervalStr = `${Math.round(s.intervalMs / 60000)}m`;
        const newInterval = window.prompt('Repeat interval (blank for none, e.g., 1h):', intervalStr);
        const iv = this.parseIntervalInput(newInterval || '');
        try {
            const res = await fetch(`/api/schedules/${s.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ when: parsed, intervalMs: iv || null })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data && data.error ? data.error : `Failed (${res.status})`);
            window.VacEventBus.emit('log', { type: 'success', message: 'Schedule updated.' });
            this.load();
        } catch (e) {
            window.VacEventBus.emit('log', { type: 'error', message: `Update failed: ${e.message}` });
        }
    }
}
