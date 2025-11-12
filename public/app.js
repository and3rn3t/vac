/**
 * Frontend application for Roomba local control
 * Handles UI interactions and WebSocket communication
 */

class RoombaApp {
    constructor() {
        this.ws = null;
        this.connected = false;
        this.state = {};
        this.currentMissionId = null;
        this.wasCleaning = false;
        this.mapData = null;
        
        this.initializeElements();
        this.attachEventListeners();
        this.connectWebSocket();
        // Components handle canvas/rooms/schedules; app just emits events.
    }

    initializeElements() {
        // Connection elements
        this.discoverBtn = document.getElementById('discoverBtn');
        this.connectBtn = document.getElementById('connectBtn');
        this.disconnectBtn = document.getElementById('disconnectBtn');
        this.ipInput = document.getElementById('ipInput');
        this.blidInput = document.getElementById('blidInput');
        this.passwordInput = document.getElementById('passwordInput');
        this.discoveryResults = document.getElementById('discoveryResults');

        // Control elements
        this.startBtn = document.getElementById('startBtn');
        this.pauseBtn = document.getElementById('pauseBtn');
        this.stopBtn = document.getElementById('stopBtn');
        this.dockBtn = document.getElementById('dockBtn');

        // Status elements
        this.statusIndicator = document.getElementById('statusIndicator');
        this.statusText = document.getElementById('statusText');
        this.batteryLevel = document.getElementById('batteryLevel');
        this.batteryBar = document.getElementById('batteryBar');
        this.cleaningStatus = document.getElementById('cleaningStatus');
        this.binStatus = document.getElementById('binStatus');
        this.position = document.getElementById('position');

        // Sensor elements
        this.missionProgress = document.getElementById('missionProgress');
        this.runtime = document.getElementById('runtime');
        this.areaCleaned = document.getElementById('areaCleaned');

        // Log container
        this.logContainer = document.getElementById('logContainer');

        // Map elements
    // Map/Rooms elements are owned by their components.
        // Scheduling elements
        this.scheduleAction = document.getElementById('scheduleAction');
        this.scheduleWhenInput = document.getElementById('scheduleWhenInput');
        this.scheduleIntervalInput = document.getElementById('scheduleIntervalInput');
        this.createScheduleBtn = document.getElementById('createScheduleBtn');
        this.refreshSchedulesBtn = document.getElementById('refreshSchedulesBtn');
        this.scheduleList = document.getElementById('scheduleList');
        this.scheduleFilterStatus = document.getElementById('scheduleFilterStatus');
        this.scheduleFilterAction = document.getElementById('scheduleFilterAction');
        this.scheduleSortBtn = document.getElementById('scheduleSortBtn');
    }

    attachEventListeners() {
        this.discoverBtn.addEventListener('click', () => this.discoverRoombas());
        this.connectBtn.addEventListener('click', () => this.connect());
        this.disconnectBtn.addEventListener('click', () => this.disconnect());
        
        this.startBtn.addEventListener('click', () => this.sendCommand('start'));
        this.pauseBtn.addEventListener('click', () => this.sendCommand('pause'));
        this.stopBtn.addEventListener('click', () => this.sendCommand('stop'));
        this.dockBtn.addEventListener('click', () => this.sendCommand('dock'));

        // Room control events are handled by RoomsComponent.

        // Schedule-related event listeners migrated to ScheduleListComponent.
    }

    // Map canvas helpers removed; handled by MapCanvasComponent.

    connectWebSocket() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}`;
        
        this.log('Connecting to server...', 'info');
        this.ws = new WebSocket(wsUrl);

        this.ws.onopen = () => {
            this.log('WebSocket connected', 'success');
        };

        this.ws.onmessage = (event) => {
            const message = JSON.parse(event.data);
            this.handleMessage(message);
        };

        this.ws.onerror = (error) => {
            this.log('WebSocket error', 'error');
            console.error('WebSocket error:', error);
        };

        this.ws.onclose = () => {
            this.log('WebSocket disconnected. Reconnecting...', 'info');
            setTimeout(() => this.connectWebSocket(), 3000);
        };
    }

    handleMessage(message) {
        switch (message.type) {
            case 'stateUpdate':
                this.updateState(message.data);
                break;
            case 'connectionStatus':
                this.updateConnectionStatus(message.connected);
                break;
            case 'command':
                this.log(`Command '${message.command}' acknowledged (requestId=${message.requestId})`, 'info');
                break;
            case 'schedule':
                this.handleScheduleEvent(message);
                break;
            case 'error':
                this.log(`Error: ${message.message}`, 'error');
                break;
        }
        if (window.VacEventBus) {
            window.VacEventBus.emit('rawMessage', message);
        }
    }

    handleScheduleEvent(msg) {
        if (!msg || msg.type !== 'schedule') return;
        const s = msg.schedule || {};
        const when = s.scheduledAt ? new Date(s.scheduledAt).toLocaleString() : 'n/a';
        const label = s.action || 'action';
        switch (msg.event) {
            case 'created':
                this.log(`Scheduled '${label}' at ${when} (id=${s.id || 'n/a'}).`, 'info');
                this.loadSchedulesDebounced();
                break;
            case 'executing':
                this.log(`Executing scheduled '${label}'...`, 'info');
                break;
            case 'executed':
                this.log(`Scheduled '${label}' executed successfully.`, 'success');
                this.loadSchedulesDebounced();
                break;
            case 'failed':
                this.log(`Scheduled '${label}' failed: ${(s.result && s.result.message) || 'unknown error'}.`, 'error');
                this.loadSchedulesDebounced();
                break;
            case 'canceled':
                this.log(`Scheduled '${label}' canceled.`, 'info');
                this.loadSchedulesDebounced();
                break;
            default:
                this.log(`Schedule event '${msg.event}' for '${label}'.`, 'info');
        }
        if (window.VacEventBus) {
            window.VacEventBus.emit('scheduleEvent', msg);
        }
    }

    async loadSchedules() {
        if (!this.scheduleList) return;
        try {
            const res = await fetch('/api/schedules');
            const data = await res.json();
            const items = Array.isArray(data.items) ? data.items : [];
            this._allSchedules = items;
            this.applyScheduleFilters();
            this.ensureScheduleTicker();
        } catch (e) {
            this.log(`Failed to load schedules: ${e.message}`, 'error');
        }
    }

    loadSchedulesDebounced() {
        if (this._scheduleReloadTimer) {
            clearTimeout(this._scheduleReloadTimer);
        }
        this._scheduleReloadTimer = setTimeout(() => {
            this._scheduleReloadTimer = null;
            this.loadSchedules();
        }, 250);
    }

    renderScheduleList(items) {
        const list = this.scheduleList;
        if (!list) return;
        list.innerHTML = '';
        if (!items.length) {
            const empty = document.createElement('div');
            empty.className = 'schedule-empty';
            empty.textContent = 'No schedules yet.';
            list.appendChild(empty);
            return;
        }
        items.forEach(s => {
            const el = document.createElement('div');
            el.className = `schedule-item ${s.status}`;
            const title = document.createElement('div');
            title.innerHTML = `<strong>${s.action}</strong> <span class="schedule-status-label ${s.status}">${s.status}</span>`;
            const time = document.createElement('div');
            const when = s.scheduledAt ? new Date(s.scheduledAt).toLocaleString() : 'n/a';
            const execInfo = s.executedAt ? ` · ran ${new Date(s.executedAt).toLocaleTimeString()}` : '';
            time.className = 'schedule-time';
            const countdown = this.formatCountdown(s.scheduledAt);
            time.textContent = `At ${when}${execInfo}${countdown ? ` · in ${countdown}` : ''}`;
            el.appendChild(title);
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

                // Edit action
                const editBtn = document.createElement('button');
                editBtn.type = 'button';
                editBtn.className = 'btn btn-secondary btn-compact';
                editBtn.textContent = 'Edit';
                editBtn.addEventListener('click', () => this.editSchedulePrompt(s));
                actions.appendChild(editBtn);
                el.appendChild(actions);
            }
            list.appendChild(el);
        });
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

    ensureScheduleTicker() {
        if (this._scheduleTicker) return;
        this._scheduleTicker = setInterval(() => {
            if (!this._allSchedules || !this._allSchedules.length) return;
            this.applyScheduleFilters({ skipSortState: true });
        }, 1000);
    }

    toggleScheduleSort() {
        this._scheduleSortAsc = !this._scheduleSortAsc;
        if (this.scheduleSortBtn) {
            this.scheduleSortBtn.textContent = `Sort: ${this._scheduleSortAsc ? 'Soonest' : 'Latest'}`;
        }
        this.applyScheduleFilters();
    }

    applyScheduleFilters(opts = {}) {
        const status = this.scheduleFilterStatus ? this.scheduleFilterStatus.value : '';
        const action = this.scheduleFilterAction ? this.scheduleFilterAction.value : '';
        const asc = this._scheduleSortAsc !== false; // default soonest first
        let items = Array.isArray(this._allSchedules) ? [...this._allSchedules] : [];
        if (status) items = items.filter(s => s.status === status);
        if (action) items = items.filter(s => s.action === action);
        items.sort((a, b) => (asc ? (a.scheduledAt - b.scheduledAt) : (b.scheduledAt - a.scheduledAt)));
        this.renderScheduleList(items);
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
        // duration like 10m, 5s, 2h
        const durMatch = trimmed.match(/^([0-9]+)(ms|s|m|h|d)$/i);
        if (durMatch) {
            const n = parseInt(durMatch[1], 10);
            const unit = durMatch[2].toLowerCase();
            const factors = { ms: 1, s: 1000, m: 60000, h: 3600000, d: 86400000 };
            return Date.now() + n * (factors[unit] || 0);
        }
        // 'in 10m'
        const inMatch = trimmed.match(/^in\s+([0-9]+)(ms|s|m|h|d)$/i);
        if (inMatch) {
            const n = parseInt(inMatch[1], 10);
            const unit = inMatch[2].toLowerCase();
            const factors = { ms: 1, s: 1000, m: 60000, h: 3600000, d: 86400000 };
            return Date.now() + n * (factors[unit] || 0);
        }
        // ISO timestamp
        const asDate = new Date(trimmed);
        if (!isNaN(asDate.getTime())) return asDate.getTime();
        return null;
    }

    buildCleanRoomsPayloadForSchedule() {
        const regions = Array.from(this.selectedRegionIds).map(id => ({ region_id: id }));
        if (!regions.length) return null;
        const payload = { regions, ordered: this.roomOrderToggle ? !!this.roomOrderToggle.checked : true };
        if (this.mapData && this.mapData.mapId) payload.mapId = this.mapData.mapId;
        if (this.state && this.state.userPmapvId) payload.userPmapvId = this.state.userPmapvId;
        return payload;
    }

    async createSchedule() {
        if (!this.scheduleAction || !this.scheduleWhenInput) return;
        const action = this.scheduleAction.value;
        const whenRaw = this.scheduleWhenInput.value;
        const scheduledAt = this.parseWhenInput(whenRaw);
        if (!scheduledAt) {
            this.log('Invalid schedule time format. Use ISO or patterns like 10m / in 5m.', 'error');
            return;
        }
        const body = { action, when: scheduledAt };
        const iv = this.parseIntervalInput(this.scheduleIntervalInput ? this.scheduleIntervalInput.value : '');
        if (iv && Number.isFinite(iv) && iv > 0) body.intervalMs = iv;
        if (action === 'cleanRooms') {
            const payload = this.buildCleanRoomsPayloadForSchedule();
            if (!payload) {
                this.log('Select at least one room before scheduling cleanRooms.', 'error');
                return;
            }
            body.payload = payload;
        }
        try {
            this.createScheduleBtn.disabled = true;
            const res = await fetch('/api/schedules', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data && data.error ? data.error : `Failed (${res.status})`);
            this.log(`Schedule created for '${action}'.`, 'success');
            this.scheduleWhenInput.value = '';
            if (this.scheduleIntervalInput) this.scheduleIntervalInput.value = '';
            this.loadSchedules();
        } catch (e) {
            this.log(`Create schedule failed: ${e.message}`, 'error');
        } finally {
            this.createScheduleBtn.disabled = false;
        }
    }

    async cancelSchedule(id) {
        if (!id) return;
        try {
            const res = await fetch(`/api/schedules/${id}`, { method: 'DELETE' });
            const data = await res.json();
            if (!res.ok) throw new Error(data && data.error ? data.error : `Failed (${res.status})`);
            this.log(`Canceled schedule ${id}.`, 'info');
            this.loadSchedules();
        } catch (e) {
            this.log(`Cancel schedule failed: ${e.message}`, 'error');
        }
    }

    async editSchedulePrompt(s) {
        const newWhen = window.prompt('Update time (ISO or relative like 10m):', s.scheduledAt ? new Date(s.scheduledAt).toISOString().slice(0,16) : '');
        if (newWhen === null) return;
        const parsed = this.parseWhenInput(String(newWhen));
        if (!parsed) {
            this.log('Invalid time input.', 'error');
            return;
        }
        let intervalStr = '';
        if (s.intervalMs && Number.isFinite(s.intervalMs)) {
            intervalStr = `${Math.round(s.intervalMs / 60000)}m`;
        }
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
            this.log('Schedule updated.', 'success');
            this.loadSchedules();
        } catch (e) {
            this.log(`Update failed: ${e.message}`, 'error');
        }
    }

    updateConnectionStatus(connected) {
        this.connected = connected;
        if (connected) {
            this.statusIndicator.classList.add('connected');
            this.statusText.textContent = 'Connected';
            this.disconnectBtn.disabled = false;
            this.enableControls();
            this.log('Connected to Roomba', 'success');
        } else {
            this.statusIndicator.classList.remove('connected');
            this.statusText.textContent = 'Not Connected';
            this.disconnectBtn.disabled = true;
            this.disableControls();
            this.log('Disconnected from Roomba', 'info');
            // Clear map data and notify components.
            this.mapData = null;
            if (window.VacEventBus) window.VacEventBus.emit('mapUpdate', null);
        }
        if (window.VacEventBus) window.VacEventBus.emit('connectionStatus', connected);
    }

    updateState(state) {
        this.state = state;
        // (Robot status, maps, rooms delegated to components.)
        this.wasCleaning = !!state.cleaning;
        if (window.VacEventBus) window.VacEventBus.emit('stateUpdate', state);
    }

    async discoverRoombas() {
        this.log('Discovering Roombas on network...', 'info');
        this.discoverBtn.disabled = true;
        this.discoveryResults.innerHTML = '<p>Scanning network...</p>';
        this.discoveryResults.classList.add('show');

        try {
            const response = await fetch('/api/discover');
            const data = await response.json();

            if (data.robots && data.robots.length > 0) {
                this.log(`Found ${data.robots.length} robot(s)`, 'success');
                this.displayDiscoveredRobots(data.robots);
            } else {
                this.discoveryResults.innerHTML = '<p>No Roombas found. Make sure your Roomba is on and connected to the same network.</p>';
                this.log('No Roombas found', 'info');
            }
        } catch (error) {
            this.log(`Discovery failed: ${error.message}`, 'error');
            this.discoveryResults.innerHTML = '<p>Discovery failed. Check console for details.</p>';
        } finally {
            this.discoverBtn.disabled = false;
        }
    }

    displayDiscoveredRobots(robots) {
        this.discoveryResults.innerHTML = '';
        
        robots.forEach(robot => {
            const robotDiv = document.createElement('div');
            robotDiv.className = 'robot-item';
            robotDiv.innerHTML = `
                <strong>${robot.name || 'Roomba'}</strong>
                <div>IP: ${robot.ip}</div>
                ${robot.blid ? `<div>BLID: ${robot.blid}</div>` : ''}
            `;
            
            robotDiv.addEventListener('click', () => {
                this.ipInput.value = robot.ip;
                if (robot.blid) {
                    this.blidInput.value = robot.blid;
                }
            });
            
            this.discoveryResults.appendChild(robotDiv);
        });
    }

    async connect() {
        const ip = this.ipInput.value.trim();
        const blid = this.blidInput.value.trim();
        const password = this.passwordInput.value.trim();

        if (!ip || !blid || !password) {
            alert('Please fill in all connection fields');
            return;
        }

        this.log('Connecting to Roomba...', 'info');
        this.connectBtn.disabled = true;

        try {
            const response = await fetch('/api/connect', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ip, blid, password })
            });

            const data = await response.json();

            if (response.ok) {
                this.log(data.message, 'success');
            } else {
                throw new Error(data.error);
            }
        } catch (error) {
            this.log(`Connection failed: ${error.message}`, 'error');
            alert(`Failed to connect: ${error.message}`);
        } finally {
            this.connectBtn.disabled = false;
        }
    }

    async disconnect() {
        this.log('Disconnecting...', 'info');

        try {
            const response = await fetch('/api/disconnect', { method: 'POST' });
            const data = await response.json();
            this.log(data.message, 'info');
        } catch (error) {
            this.log(`Disconnect failed: ${error.message}`, 'error');
        }
    }

    async sendCommand(command) {
        this.log(`Sending command: ${command}`, 'info');

        try {
            const response = await fetch(`/api/${command}`, { method: 'POST' });
            const data = await response.json();

            if (response.ok) {
                this.log(data.message, 'success');
            } else {
                throw new Error(data.error);
            }
        } catch (error) {
            this.log(`Command failed: ${error.message}`, 'error');
            alert(`Failed to execute command: ${error.message}`);
        }
    }

    handleMapUpdate(state) {
        // Delegated.
    }

    extractMissionId(mission) {
        if (!mission || typeof mission !== 'object') {
            return null;
        }
        return (
            mission.missionId ||
            mission.mssid ||
            mission.mssnId ||
            mission.sMissionId ||
            mission.runId ||
            mission.cMissionId ||
            (mission.cycle && mission.nMssn !== undefined ? `${mission.cycle}:${mission.nMssn}` : mission.cycle) ||
            null
        );
    }

    drawMap(data, options = {}) {
        // Delegated.
        if (window.VacEventBus) {
            window.VacEventBus.emit('mapUpdate', this.mapData);
        }
    }


    formatMissionLabel(data) {
        if (!data) {
            return 'Mission';
        }

        const mission = data.mission || {};

        if (mission.nMssn !== undefined) {
            return `Mission #${mission.nMssn}`;
        }

        if (mission.cycle) {
            return `Mission ${mission.cycle}`;
        }

        if (data.missionId) {
            return `Mission ${data.missionId}`;
        }

        return 'Mission';
    }

    enableControls() {
        this.startBtn.disabled = false;
        this.pauseBtn.disabled = false;
        this.stopBtn.disabled = false;
        this.dockBtn.disabled = false;
    }

    disableControls() {
        this.startBtn.disabled = true;
        this.pauseBtn.disabled = true;
        this.stopBtn.disabled = true;
        this.dockBtn.disabled = true;
    }

    log(message, type = 'info') {
        const entry = document.createElement('div');
        entry.className = `log-entry ${type}`;
        entry.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
        
        this.logContainer.insertBefore(entry, this.logContainer.firstChild);
        
        // Keep only last 50 entries
        while (this.logContainer.children.length > 50) {
            this.logContainer.removeChild(this.logContainer.lastChild);
        }
        if (window.VacEventBus) {
            window.VacEventBus.emit('log', { message, type });
        }
    }
}

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    const app = new RoombaApp();
    window.roombaApp = app; // expose for components / debugging
    if (window.VacEventBus) {
        window.VacEventBus.emit('appReady', app);
    }
});
