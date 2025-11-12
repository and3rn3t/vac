import { BaseComponent } from './BaseComponent.js';

// Manages rooms & targeted cleaning: selection, rename, status messaging.
// Delegates actual cleaning command to RoombaApp.cleanSelectedRegions or direct API call.
export class RoomsComponent extends BaseComponent {
    constructor(opts = {}) {
        super(opts);
        this.roomList = document.getElementById('roomList');
        this.cleanBtn = document.getElementById('cleanRoomsBtn');
        this.clearBtn = document.getElementById('clearRoomsBtn');
        this.orderToggle = document.getElementById('roomOrderToggle');
        this.roomStatus = document.getElementById('roomStatus');
        this.roomStaleness = document.getElementById('roomStaleness');
        this.selectedRegionIds = new Set();
        this.roomNameOverrides = new Map();
        this.regionColors = new Map();
    // Techy, high-contrast palette for dark theme (no purple)
    this.palette = ['#39ff14', '#00d46a', '#38bdf8', '#ffa94d', '#ff6b6b', '#20c997', '#40c057', '#facc15', '#94a3b8', '#9ca3af'];
        this.activeTargetedClean = null;
        this.roomMetadataStaleMs = 60000;
        this.mapData = null;
        this.mapTimestamp = 0;
        this.loadStoredNames();
    }

    bind() {
        if (this.cleanBtn) this.cleanBtn.addEventListener('click', () => this.startTargetedClean());
        if (this.clearBtn) this.clearBtn.addEventListener('click', () => this.clearSelection());
        if (this.roomList) {
            this.roomList.addEventListener('change', (e) => this.onListChange(e));
            this.roomList.addEventListener('click', (e) => this.onRenameClick(e));
        }
        this.subscribe('stateUpdate', (s) => this.onStateUpdate(s));
        this.subscribe('mapUpdate', (map) => this.onMapUpdate(map));
        this.subscribe('connectionStatus', () => this.syncControls());
        this.subscribe('appReady', () => this.renderInitial());
    }

    renderInitial() {
        const app = window.roombaApp;
        if (app && app.state && app.state.regions) this.renderRegionList(app.state.regions);
    }

    onMapUpdate(map) {
        this.mapData = map || null;
        this.mapTimestamp = map ? Date.now() : 0;
        const regions = Array.isArray(map && map.regions) ? map.regions : [];
        if (regions.length) this.renderRegionList(regions);
        this.syncControls();
    }

    isMapFresh() {
        return this.mapData && (Date.now() - this.mapTimestamp < this.roomMetadataStaleMs);
    }

    onStateUpdate(state) {
        if (!state) return;
        if ((!this.mapData || !Array.isArray(this.mapData.regions) || !this.mapData.regions.length) && Array.isArray(state.regions) && state.regions.length) {
            this.renderRegionList(state.regions);
        }
        this.updateActiveCleanTracking(state);
    }

    onListChange(e) {
        const target = e.target;
        if (!target || target.tagName !== 'INPUT') return;
        const regionId = target.dataset.regionId;
        if (!regionId) return;
        if (target.checked) this.selectedRegionIds.add(regionId); else this.selectedRegionIds.delete(regionId);
        const wrapper = target.closest('.room-item');
        if (wrapper) wrapper.classList.toggle('selected', target.checked);
        this.syncControls();
        window.VacEventBus.emit('roomSelectionChanged', Array.from(this.selectedRegionIds));
    }

    onRenameClick(e) {
        const btn = e.target.closest('button[data-action="rename"]');
        if (!btn) return;
        e.preventDefault();
        const regionId = btn.dataset.regionId;
        const currentName = btn.dataset.currentName || regionId;
        const proposed = window.prompt('Enter a name for this area', currentName);
        if (proposed === null) return;
        this.setOverride(regionId, proposed);
        this.refreshListNames();
    }

    setOverride(id, name) {
        const trimmed = (name || '').trim();
        if (trimmed) this.roomNameOverrides.set(id, trimmed); else this.roomNameOverrides.delete(id);
        this.persistNames();
    }

    refreshListNames() {
        const checkboxes = this.roomList ? this.roomList.querySelectorAll('input[data-region-id]') : [];
        checkboxes.forEach(cb => {
            const id = cb.dataset.regionId;
            const wrapper = cb.closest('.room-item');
            if (wrapper) {
                const span = wrapper.querySelector('.room-label span:last-child');
                if (span) span.textContent = this.lookupName(id);
            }
        });
        this.syncControls();
    }

    loadStoredNames() {
        try {
            const raw = typeof localStorage !== 'undefined' ? localStorage.getItem('vac_room_name_overrides') : null;
            if (raw) {
                const parsed = JSON.parse(raw);
                Object.entries(parsed || {}).forEach(([k,v]) => { if (typeof v === 'string') this.roomNameOverrides.set(k, v); });
            }
        } catch(_) {}
    }

    persistNames() {
        try {
            if (typeof localStorage !== 'undefined') localStorage.setItem('vac_room_name_overrides', JSON.stringify(Object.fromEntries(this.roomNameOverrides.entries())));
        } catch(_) {}
    }

    lookupName(id) {
        if (!id) return '';
        return this.roomNameOverrides.get(String(id)) || `Region ${id}`;
    }

    assignColor(id) {
        if (!this.regionColors.has(id)) {
            const idx = this.regionColors.size % this.palette.length;
            this.regionColors.set(id, this.palette[idx]);
        }
        return this.regionColors.get(id);
    }

    renderRegionList(regions) {
        if (!this.roomList) return;
        this.roomList.innerHTML = '';
        if (!Array.isArray(regions) || !regions.length) {
            const empty = document.createElement('div');
            empty.className = 'room-empty';
            empty.textContent = 'No rooms discovered yet.';
            this.roomList.appendChild(empty);
            this.selectedRegionIds.clear();
            this.syncControls();
            return;
        }
        const validIds = new Set();
        regions.forEach(region => {
            const rawId = region && (region.id ?? region.region_id ?? region.regionId);
            if (rawId === undefined || rawId === null) return;
            const id = String(rawId);
            if (validIds.has(id)) return;
            validIds.add(id);
            this.assignColor(id);
            const name = this.lookupName(id);
            const item = document.createElement('div');
            item.className = 'room-item';
            const label = document.createElement('label');
            label.className = 'room-label';
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.dataset.regionId = id;
            checkbox.checked = this.selectedRegionIds.has(id);
            const colorDot = document.createElement('span');
            colorDot.className = 'room-color-dot';
            colorDot.style.backgroundColor = this.regionColors.get(id);
            const nameSpan = document.createElement('span');
            nameSpan.textContent = name;
            label.appendChild(checkbox);
            label.appendChild(colorDot);
            label.appendChild(nameSpan);
            const actions = document.createElement('div');
            actions.className = 'room-actions';
            const tag = document.createElement('span');
            tag.className = 'room-tag';
            tag.textContent = (region.type || 'rid').toUpperCase();
            const renameBtn = document.createElement('button');
            renameBtn.type = 'button';
            renameBtn.className = 'room-rename-btn';
            renameBtn.dataset.action = 'rename';
            renameBtn.dataset.regionId = id;
            renameBtn.dataset.currentName = name;
            renameBtn.textContent = 'Rename';
            actions.appendChild(tag);
            actions.appendChild(renameBtn);
            item.appendChild(label);
            item.appendChild(actions);
            if (checkbox.checked) item.classList.add('selected');
            this.roomList.appendChild(item);
        });
        // prune removed selections
        [...this.selectedRegionIds].forEach(id => { if (!validIds.has(id)) this.selectedRegionIds.delete(id); });
        this.syncControls();
    }

    syncControls() {
        const connected = !!(window.roombaApp && window.roombaApp.connected);
        const hasRegions = this.mapData && Array.isArray(this.mapData.regions) && this.mapData.regions.length;
        const fresh = this.isMapFresh();
        const hasSelection = this.selectedRegionIds.size > 0;
        if (this.cleanBtn) {
            this.cleanBtn.disabled = !(connected && hasSelection && hasRegions && fresh);
            this.cleanBtn.title = !fresh ? 'Room metadata is stale; waiting for map refresh.' : '';
        }
        if (this.clearBtn) this.clearBtn.disabled = !hasSelection;
        if (this.orderToggle) this.orderToggle.disabled = !(hasSelection && this.selectedRegionIds.size > 1);
        if (this.roomStaleness) {
            if (!connected) {
                this.roomStaleness.textContent = 'Connect to the robot to refresh room metadata.';
                this.roomStaleness.classList.remove('hidden');
            } else if (hasRegions && !fresh) {
                this.roomStaleness.textContent = 'Room metadata is out of date. Refreshing...';
                this.roomStaleness.classList.remove('hidden');
            } else {
                this.roomStaleness.classList.add('hidden');
            }
        }
        if (this.roomStatus) {
            let msg = '';
            if (!connected) msg = 'Connect to a robot to enable targeted cleaning.';
            else if (!hasRegions) msg = 'No mapped rooms yet. Start a full clean.';
            else if (!fresh) msg = 'Waiting for latest room map...';
            else if (!hasSelection) msg = 'Select rooms to start a targeted clean.';
            if (this.activeTargetedClean) {
                const names = this.activeTargetedClean.regionNames || this.activeTargetedClean.regionIds;
                const summary = names.join(', ');
                if (this.activeTargetedClean.completedAt) msg = `Completed targeted clean for ${summary}.`; else if (this.activeTargetedClean.startedAt) msg = `Targeted cleaning ${summary}...`; else msg = `Targeted clean requested for ${summary}. Waiting to start...`;
            }
            if (msg) {
                this.roomStatus.textContent = msg;
                this.roomStatus.classList.remove('hidden');
            } else {
                this.roomStatus.classList.add('hidden');
            }
        }
    }

    clearSelection() {
        if (!this.selectedRegionIds.size) return;
        this.selectedRegionIds.clear();
        if (this.roomList) this.roomList.querySelectorAll('input[type="checkbox"][data-region-id]').forEach(cb => {
            cb.checked = false;
            const wrap = cb.closest('.room-item');
            if (wrap) wrap.classList.remove('selected');
        });
        this.syncControls();
        window.VacEventBus.emit('roomSelectionChanged', []);
    }

    buildPayload() {
        const regions = Array.from(this.selectedRegionIds).map(id => ({ region_id: id }));
        const ordered = this.orderToggle ? !!this.orderToggle.checked : true;
        const app = window.roombaApp;
        const payload = { regions, ordered };
        if (app && app.mapData && app.mapData.mapId) payload.mapId = app.mapData.mapId;
        if (app && app.state && app.state.userPmapvId) payload.userPmapvId = app.state.userPmapvId;
        return payload;
    }

    async startTargetedClean() {
        if (!this.selectedRegionIds.size) return;
        const payload = this.buildPayload();
        try {
            if (this.cleanBtn) {
                this.cleanBtn.disabled = true;
                const original = this.cleanBtn.textContent;
                this.cleanBtn.textContent = 'Sending...';
                const res = await fetch('/api/cleanRooms', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
                const data = await res.json();
                if (!res.ok) throw new Error(data && data.error ? data.error : `Failed (${res.status})`);
                this.setActiveTargetedClean(Array.from(this.selectedRegionIds));
                window.VacEventBus.emit('log', { type: 'success', message: `Targeted clean started for ${this.activeTargetedClean.regionNames.join(', ')}` });
                this.cleanBtn.textContent = original;
                this.cleanBtn.disabled = false;
            }
        } catch (e) {
            window.VacEventBus.emit('log', { type: 'error', message: `Targeted clean failed: ${e.message}` });
            if (this.cleanBtn) this.cleanBtn.disabled = false;
        } finally {
            this.syncControls();
        }
    }

    setActiveTargetedClean(regionIds) {
        const normalized = regionIds.map(r => String(r));
        const names = normalized.map(id => this.lookupName(id));
        this.activeTargetedClean = { regionIds: normalized, regionNames: names, requestedAt: Date.now(), startedAt: null, completedAt: null };
        this.syncControls();
    }

    updateActiveCleanTracking(state) {
        if (!this.activeTargetedClean) return;
        if (state && state.cleaning) {
            if (!this.activeTargetedClean.startedAt) {
                this.activeTargetedClean.startedAt = Date.now();
                this.syncControls();
            }
            return;
        }
        if (this.activeTargetedClean.startedAt && !this.activeTargetedClean.completedAt) {
            this.activeTargetedClean.completedAt = Date.now();
            this.syncControls();
        }
    }
}
