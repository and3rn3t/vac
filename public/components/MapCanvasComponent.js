import { BaseComponent } from './BaseComponent.js';

// Handles map fetching, drawing, resizing, mission tracking, and region highlighting.
export class MapCanvasComponent extends BaseComponent {
    constructor(opts = {}) {
        super(opts);
        this.canvas = document.getElementById('mapCanvas');
        this.statusEl = document.getElementById('mapStatus');
        this.metaEl = document.getElementById('mapMeta');
        this.cooldownMs = 5000;
        this.lastFetch = 0;
        this.fetchInFlight = false;
        this.pendingTimer = null;
        this.currentMissionId = null;
        this.lastRenderedMissionId = null;
        this.mapData = null;
        this.mapDataTimestamp = 0;
        this.roomMetadataStaleMs = 60000;
        this.ctx = this.canvas ? this.canvas.getContext('2d') : null;
        this.handleResize = this.handleResize.bind(this);
    }

    bind() {
        this.subscribe('stateUpdate', (s) => this.onStateUpdate(s));
        window.addEventListener('resize', this.handleResize);
        this.setCanvasSize();
    }

    destroy() {
        super.destroy();
        window.removeEventListener('resize', this.handleResize);
        if (this.pendingTimer) clearTimeout(this.pendingTimer);
    }

    onStateUpdate(state) {
        const missionId = this.extractMissionId(state && state.mission);
        const cleaning = !!(state && state.cleaning);
        const missionChanged = missionId !== this.currentMissionId;
        const wasCleaning = !!(window.roombaApp && window.roombaApp.wasCleaning);
        this.currentMissionId = missionId;
        if (missionChanged || (cleaning && !wasCleaning) || (!cleaning && wasCleaning)) {
            this.fetchMap(true);
            return;
        }
        if (cleaning) this.fetchMap();
    }

    extractMissionId(mission) {
        if (!mission || typeof mission !== 'object') return null;
        return (
            mission.missionId || mission.mssid || mission.mssnId || mission.sMissionId || mission.runId || mission.cMissionId ||
            (mission.cycle && mission.nMssn !== undefined ? `${mission.cycle}:${mission.nMssn}` : mission.cycle) || null
        );
    }

    handleResize() { this.setCanvasSize(true); }

    setCanvasSize(force = false) {
        if (!this.canvas || !this.ctx) return;
        const parent = this.canvas.parentElement;
        const parentWidth = parent ? parent.clientWidth : this.canvas.clientWidth;
        const size = Math.max(Math.min(parentWidth || 400, 600), 240);
        if (this.canvas.width !== size || this.canvas.height !== size) {
            this.canvas.width = size;
            this.canvas.height = size;
            this.canvas.style.height = `${size}px`;
            if (force && this.mapData) this.drawMap(this.mapData, { skipResize: true });
        }
    }

    clearSurface() {
        if (!this.ctx || !this.canvas) return;
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this.ctx.fillStyle = '#0f141a';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }

    setOverlay(message, { preserve = false } = {}) {
        if (!preserve) this.clearSurface();
        if (this.statusEl) {
            this.statusEl.textContent = message;
            this.statusEl.classList.remove('hidden');
        }
        if (!preserve && this.metaEl) this.metaEl.textContent = '';
    }

    hideOverlay() { if (this.statusEl) this.statusEl.classList.add('hidden'); }

    fetchMap(force = false) {
        if (!this.canvas) return;
        if (this.fetchInFlight && !force) return;
        const now = Date.now();
        if (!force) {
            const elapsed = now - this.lastFetch;
            if (elapsed < this.cooldownMs) {
                if (!this.pendingTimer) {
                    const delay = this.cooldownMs - elapsed;
                    this.pendingTimer = setTimeout(() => { this.pendingTimer = null; this.fetchMap(true); }, Math.max(delay, 0));
                }
                return;
            }
        } else if (this.pendingTimer) {
            clearTimeout(this.pendingTimer); this.pendingTimer = null;
        }
        this.fetchInFlight = true;
        this.setOverlay(force ? 'Loading map...' : 'Updating map...', { preserve: !!this.mapData });
        const params = new URLSearchParams();
        if (this.currentMissionId) params.set('missionId', this.currentMissionId);
        const query = params.toString();
        fetch(`/api/map${query ? `?${query}` : ''}`)
            .then(res => {
                if (res.status === 404) return { notFound: true };
                return res.json().then(j => (res.ok ? j : Promise.reject(new Error(j && j.error ? j.error : `Status ${res.status}`))));
            })
            .then(data => {
                if (data.notFound) {
                    this.mapData = null; this.lastFetch = now; this.setOverlay('No mission map data yet.', { preserve: false });
                    if (this.metaEl) this.metaEl.textContent = 'No mission data yet.';
                    this.mapDataTimestamp = 0;
                    this.emitMapUpdate();
                    return;
                }
                this.drawMap(data);
                this.lastFetch = Date.now();
            })
            .catch(err => { console.error('Map fetch failed:', err); this.setOverlay('Map unavailable.'); this.mapDataTimestamp = 0; this.emitMapUpdate(); })
            .finally(() => { this.fetchInFlight = false; });
    }

    emitMapUpdate() {
        if (window.VacEventBus) window.VacEventBus.emit('mapUpdate', this.mapData);
        if (window.roombaApp) window.roombaApp.mapData = this.mapData;
    }

    drawMap(data, { skipResize = false } = {}) {
        if (!this.canvas || !this.ctx) return;
        if (!skipResize) this.setCanvasSize();
        this.mapData = data || null;
        this.mapDataTimestamp = data ? Date.now() : 0;
        const updateRegions = true; // Regions used by RoomsComponent; we just emit mapUpdate.
        if (!data || !Array.isArray(data.points) || !data.points.length) {
            this.setOverlay('Path data not available yet.');
            if (this.metaEl) this.metaEl.textContent = `${this.formatMissionLabel(data)} · 0 points`;
            this.emitMapUpdate();
            return;
        }
        const missionChanged = data.missionId !== this.lastRenderedMissionId;
        if (missionChanged) this.lastRenderedMissionId = data.missionId || null;
        const bounds = data.bounds;
        if (!bounds) {
            this.setOverlay('Bounds unavailable.');
            this.emitMapUpdate();
            return;
        }
        this.hideOverlay();
        this.clearSurface();
        const width = this.canvas.width;
        const height = this.canvas.height;
        const padding = 24;
        const spanX = bounds.maxX - bounds.minX || 1;
        const spanY = bounds.maxY - bounds.minY || 1;
        const scale = Math.min((width - padding * 2) / spanX, (height - padding * 2) / spanY);
        const groups = this.groupPointsByRegion(data.points);
        const highlighted = this.getHighlightedRegionIds();
        const hasHighlights = highlighted.size > 0;
        groups.forEach(g => {
            if (!g.points.length) return;
            const color = this.getRegionColor(g.key);
            const isHighlighted = hasHighlights ? highlighted.has(g.key) : false;
            this.ctx.save();
            this.ctx.strokeStyle = color;
            this.ctx.lineWidth = hasHighlights ? (isHighlighted ? 3 : 1.5) : 2;
            this.ctx.globalAlpha = isHighlighted || !hasHighlights ? 1 : 0.65;
            this.ctx.lineJoin = 'round';
            this.ctx.lineCap = 'round';
            this.ctx.beginPath();
            g.points.forEach((pt, i) => {
                const p = this.project(pt, bounds, scale, padding, height);
                if (i === 0) this.ctx.moveTo(p.x, p.y); else this.ctx.lineTo(p.x, p.y);
            });
            this.ctx.stroke();
            this.ctx.restore();
        });
        // markers
        const first = this.project(data.points[0], bounds, scale, padding, height);
        const last = this.project(data.points[data.points.length - 1], bounds, scale, padding, height);
    this.drawMarker(first, '#39ff14');
    this.drawMarker(last, '#ff4d4f');
        const finalSample = data.points[data.points.length - 1];
        if (finalSample && Number.isFinite(finalSample.theta)) this.drawHeading(last, finalSample.theta);
        if (this.metaEl) {
            const label = this.formatMissionLabel(data);
            const updatedAt = new Date().toLocaleTimeString();
            const pointTotal = Number.isFinite(data.pointCount) ? data.pointCount : data.points.length;
            const regionCount = Array.isArray(data.regions) ? data.regions.length : 0;
            const regionSuffix = regionCount ? ` · ${regionCount} region${regionCount === 1 ? '' : 's'}` : '';
            this.metaEl.textContent = `${label} · ${pointTotal} points${regionSuffix} · Updated ${updatedAt}`;
        }
        this.emitMapUpdate();
    }

    groupPointsByRegion(points) {
        const groups = [];
        if (!Array.isArray(points)) return groups;
        let current = null;
        points.forEach(pt => {
            const key = this.getPointKey(pt);
            if (!current || current.key !== key) { current = { key, points: [] }; groups.push(current); }
            current.points.push(pt);
        });
        return groups;
    }

    getPointKey(pt) {
        if (!pt || typeof pt !== 'object') return 'default';
        if (pt.regionId !== undefined && pt.regionId !== null) return String(pt.regionId);
        if (pt.segmentId !== undefined && pt.segmentId !== null) return String(pt.segmentId);
        return 'default';
    }

    regionColors = new Map();
    palette = ['#39ff14', '#00d46a', '#38bdf8', '#ffa94d', '#ff6b6b', '#20c997', '#40c057', '#facc15', '#94a3b8', '#9ca3af'];
    getRegionColor(key) {
        const k = key || 'default';
        if (k === 'default' && !this.regionColors.has('default')) this.regionColors.set('default', '#64748b');
        if (!this.regionColors.has(k)) {
            const idx = this.regionColors.size % this.palette.length;
            this.regionColors.set(k, this.palette[idx]);
        }
        return this.regionColors.get(k);
    }

    getHighlightedRegionIds() {
        const rooms = window.vacComponents && window.vacComponents.rooms;
        if (!rooms || !rooms.selectedRegionIds) return new Set();
        return new Set(rooms.selectedRegionIds);
    }

    project(pt, bounds, scale, padding, canvasHeight) {
        return { x: padding + (pt.x - bounds.minX) * scale, y: canvasHeight - (padding + (pt.y - bounds.minY) * scale) };
    }

    drawMarker(pos, color) {
        if (!this.ctx) return;
        this.ctx.save();
        this.ctx.fillStyle = color;
        this.ctx.strokeStyle = '#ffffff';
        this.ctx.lineWidth = 2;
        this.ctx.beginPath();
        this.ctx.arc(pos.x, pos.y, 5, 0, Math.PI * 2);
        this.ctx.fill();
        this.ctx.stroke();
        this.ctx.restore();
    }

    drawHeading(pos, thetaDegrees) {
        if (!this.ctx) return;
        const radians = (thetaDegrees * Math.PI) / 180;
        const length = 24;
        const dx = Math.cos(radians) * length;
        const dy = Math.sin(radians) * length;
        this.ctx.save();
    this.ctx.strokeStyle = '#38bdf8';
        this.ctx.lineWidth = 2;
        this.ctx.beginPath();
        this.ctx.moveTo(pos.x, pos.y);
        this.ctx.lineTo(pos.x + dx, pos.y - dy);
        this.ctx.stroke();
        this.ctx.restore();
    }

    formatMissionLabel(data) {
        if (!data) return 'Mission';
        const mission = data.mission || {};
        if (mission.nMssn !== undefined) return `Mission #${mission.nMssn}`;
        if (mission.cycle) return `Mission ${mission.cycle}`;
        if (data.missionId) return `Mission ${data.missionId}`;
        return 'Mission';
    }
}
