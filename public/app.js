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
        this.lastMapFetch = 0;
        this.mapFetchInFlight = false;
        this.mapData = null;
    this.selectedRegionIds = new Set();
    this.regionColors = new Map();
    this.regionPalette = ['#667eea', '#ff6b6b', '#20c997', '#ffa94d', '#845ef7', '#4dabf7', '#f06595', '#40c057', '#fcc419', '#495057'];
    this.lastRenderedMissionId = null;
        this.roomNameOverrides = new Map();
    this.roomMetadataStaleMs = 60000;
    this.pendingTargetedCleanTimeoutMs = 2 * 60 * 1000;
        this.mapFetchCooldownMs = 5000;
        this.mapDataTimestamp = 0;
        this.pendingMapRefresh = null;
        this.activeTargetedClean = null;
        this.activeCleanClearTimer = null;
        this.loadStoredRoomNames();
        this.handleResize = this.handleResize.bind(this);
    this.cleanSelectedRegions = this.cleanSelectedRegions.bind(this);
    this.clearRegionSelection = this.clearRegionSelection.bind(this);
    this.handleRoomListChange = this.handleRoomListChange.bind(this);
        this.handleRoomListClick = this.handleRoomListClick.bind(this);
        this.syncRegionControls = this.syncRegionControls.bind(this);
        
        this.initializeElements();
        this.attachEventListeners();
        this.setupCanvas();
        this.connectWebSocket();
        this.syncRegionControls();
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
        this.mapCanvas = document.getElementById('mapCanvas');
        this.mapStatus = document.getElementById('mapStatus');
        this.mapMeta = document.getElementById('mapMeta');
        this.roomControls = document.getElementById('roomControls');
        this.roomList = document.getElementById('roomList');
        this.cleanRoomsBtn = document.getElementById('cleanRoomsBtn');
        this.clearRoomsBtn = document.getElementById('clearRoomsBtn');
        this.roomOrderToggle = document.getElementById('roomOrderToggle');
        this.roomStaleness = document.getElementById('roomStaleness');
        this.roomStatus = document.getElementById('roomStatus');
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

        if (this.cleanRoomsBtn) {
            this.cleanRoomsBtn.addEventListener('click', this.cleanSelectedRegions);
        }

        if (this.clearRoomsBtn) {
            this.clearRoomsBtn.addEventListener('click', this.clearRegionSelection);
        }

        if (this.roomList) {
            this.roomList.addEventListener('change', this.handleRoomListChange);
            this.roomList.addEventListener('click', this.handleRoomListClick);
        }

        if (this.createScheduleBtn) {
            this.createScheduleBtn.addEventListener('click', () => this.createSchedule());
        }

        if (this.refreshSchedulesBtn) {
            this.refreshSchedulesBtn.addEventListener('click', () => this.loadSchedules());
        }

        if (this.scheduleFilterStatus) {
            this.scheduleFilterStatus.addEventListener('change', () => this.applyScheduleFilters());
        }
        if (this.scheduleFilterAction) {
            this.scheduleFilterAction.addEventListener('change', () => this.applyScheduleFilters());
        }
        if (this.scheduleSortBtn) {
            this.scheduleSortBtn.addEventListener('click', () => this.toggleScheduleSort());
        }
    }

    setupCanvas() {
        if (!this.mapCanvas) {
            return;
        }

        this.mapCtx = this.mapCanvas.getContext('2d');
        this.setCanvasSize();
        this.clearMapSurface();
        window.addEventListener('resize', this.handleResize);
    }

    handleResize() {
        this.setCanvasSize(true);
    }

    setCanvasSize(forceRedraw = false) {
        if (!this.mapCanvas || !this.mapCtx) {
            return;
        }

        const parent = this.mapCanvas.parentElement;
        const parentWidth = parent ? parent.clientWidth : this.mapCanvas.clientWidth;
        const size = Math.max(Math.min(parentWidth || 400, 600), 240);

        if (this.mapCanvas.width !== size || this.mapCanvas.height !== size) {
            this.mapCanvas.width = size;
            this.mapCanvas.height = size;
            this.mapCanvas.style.height = `${size}px`;
        }

        if (forceRedraw && this.mapData) {
            this.drawMap(this.mapData, { skipResize: true });
        } else if (!this.mapData) {
            this.clearMapSurface();
        }
    }

    clearMapSurface() {
        if (!this.mapCtx || !this.mapCanvas) {
            return;
        }

        this.mapCtx.clearRect(0, 0, this.mapCanvas.width, this.mapCanvas.height);
        this.mapCtx.fillStyle = '#ffffff';
        this.mapCtx.fillRect(0, 0, this.mapCanvas.width, this.mapCanvas.height);
    }

    setMapOverlay(message, options = {}) {
        const preserve = options.preserve === true;
        if (!preserve) {
            this.clearMapSurface();
        }
        if (this.mapStatus) {
            this.mapStatus.textContent = message;
            this.mapStatus.classList.remove('hidden');
        }
        if (!preserve && this.mapMeta) {
            this.mapMeta.textContent = '';
        }
    }

    hideMapOverlay() {
        if (this.mapStatus) {
            this.mapStatus.classList.add('hidden');
        }
    }

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
            this.fetchMap(true);
        } else {
            this.statusIndicator.classList.remove('connected');
            this.statusText.textContent = 'Not Connected';
            this.disconnectBtn.disabled = true;
            this.disableControls();
            this.log('Disconnected from Roomba', 'info');
            this.markMapStale();
            this.renderRegionList([]);
        }

        this.syncRegionControls();
    }

    updateState(state) {
        this.state = state;

        // Update battery
        if (state.battery !== null) {
            this.batteryLevel.textContent = `${state.battery}%`;
            this.batteryBar.style.width = `${state.battery}%`;
            
            // Change color based on level
            if (state.battery < 20) {
                this.batteryBar.style.background = '#dc3545';
            } else if (state.battery < 50) {
                this.batteryBar.style.background = '#ffc107';
            } else {
                this.batteryBar.style.background = 'linear-gradient(90deg, #28a745, #20c997)';
            }
        }

        // Update cleaning status
        if (state.cleaning !== undefined) {
            this.cleaningStatus.textContent = state.cleaning ? 'Cleaning' : 'Idle';
            this.cleaningStatus.style.color = state.cleaning ? '#28a745' : '#666';
        }

        // Update bin status
        if (state.binFull !== undefined) {
            this.binStatus.textContent = state.binFull ? 'Full!' : 'OK';
            this.binStatus.style.color = state.binFull ? '#dc3545' : '#28a745';
        }

        // Update position
        if (state.position) {
            const x = Number.isFinite(state.position.x) ? state.position.x : 0;
            const y = Number.isFinite(state.position.y) ? state.position.y : 0;
            const regionId = state.position.regionId || null;
            const segmentId = state.position.segmentId || null;
            const regionLabel = regionId ? ` · region ${regionId}` : (segmentId ? ` · segment ${segmentId}` : '');
            this.position.textContent = `x: ${x.toFixed(0)}, y: ${y.toFixed(0)}${regionLabel}`;
        }

        // Update mission data
        if (state.mission) {
            const mission = state.mission;
            
            if (mission.mssnM !== undefined) {
                this.runtime.textContent = `${Math.floor(mission.mssnM / 60)}m ${mission.mssnM % 60}s`;
            }
            
            if (mission.sqft !== undefined) {
                this.areaCleaned.textContent = `${mission.sqft} sq ft`;
            }

            if (mission.phase) {
                this.missionProgress.textContent = mission.phase;
            }
        }

        if ((!this.mapData || !Array.isArray(this.mapData.regions) || !this.mapData.regions.length) && Array.isArray(state.regions) && state.regions.length) {
            this.renderRegionList(state.regions);
        }

        this.updateActiveCleanTracking(state);
        this.handleMapUpdate(state);
        this.wasCleaning = !!state.cleaning;
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
        if (!this.mapCanvas || !this.mapCtx) {
            return;
        }

        const missionId = this.extractMissionId(state ? state.mission : null);
        const missionChanged = missionId !== this.currentMissionId;

        if (missionChanged) {
            this.currentMissionId = missionId;
            this.fetchMap(true);
            return;
        }

        const cleaningNow = !!(state && state.cleaning);
        const cleaningStarted = cleaningNow && !this.wasCleaning;
        const cleaningStopped = !cleaningNow && this.wasCleaning;

        if (cleaningStarted) {
            this.fetchMap(true);
            return;
        }

        if (cleaningNow) {
            this.fetchMap();
        } else if (cleaningStopped) {
            this.fetchMap(true);
        }
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

    async fetchMap(force = false) {
        if (!this.mapCanvas) {
            return;
        }

        if (this.mapFetchInFlight && !force) {
            return;
        }

        const now = Date.now();

        if (!force) {
            const elapsed = now - this.lastMapFetch;
            if (elapsed < this.mapFetchCooldownMs) {
                if (!this.pendingMapRefresh) {
                    const delay = this.mapFetchCooldownMs - elapsed;
                    this.pendingMapRefresh = setTimeout(() => {
                        this.pendingMapRefresh = null;
                        this.fetchMap(true);
                    }, Math.max(delay, 0));
                }
                return;
            }
        } else if (this.pendingMapRefresh) {
            clearTimeout(this.pendingMapRefresh);
            this.pendingMapRefresh = null;
        }

        this.mapFetchInFlight = true;
        this.setMapOverlay(force ? 'Loading map...' : 'Updating map...', { preserve: !!this.mapData });

        try {
            const params = new URLSearchParams();
            if (this.currentMissionId) {
                params.set('missionId', this.currentMissionId);
            }
            const query = params.toString();
            const response = await fetch(`/api/map${query ? `?${query}` : ''}`);

            if (response.status === 404) {
                this.mapData = null;
                this.lastMapFetch = now;
                this.setMapOverlay('No mission map data yet.', { preserve: false });
                if (this.mapMeta) {
                    this.mapMeta.textContent = 'No mission data yet.';
                }
                this.selectedRegionIds.clear();
                this.renderRegionList([]);
                this.markMapStale();
                return;
            }

            const payload = await response.json();

            if (!response.ok) {
                throw new Error(payload && payload.error ? payload.error : `Request failed with status ${response.status}`);
            }

            this.drawMap(payload);
            this.lastMapFetch = Date.now();
        } catch (error) {
            console.error('Failed to fetch map data:', error);
            this.setMapOverlay('Map unavailable. Check server logs.', { preserve: false });
            this.markMapStale();
        } finally {
            this.mapFetchInFlight = false;
        }
    }

    drawMap(data, options = {}) {
        if (!this.mapCanvas || !this.mapCtx) {
            return;
        }

        if (!options.skipResize) {
            this.setCanvasSize();
        }

        this.mapData = data || null;
        this.mapDataTimestamp = data ? Date.now() : 0;
        const updateRegions = options.updateRegions !== false;

        if (!data || !Array.isArray(data.points) || data.points.length === 0) {
            this.setMapOverlay('Path data not available yet.', { preserve: false });
            if (this.mapMeta) {
                const label = this.formatMissionLabel(data);
                this.mapMeta.textContent = `${label} · 0 points`;
            }
            if (updateRegions) {
                const emptyRegions = Array.isArray(data && data.regions) ? data.regions : [];
                this.renderRegionList(emptyRegions);
            }
            this.syncRegionControls();
            return;
        }

        const missionChanged = data.missionId !== this.lastRenderedMissionId;
        if (missionChanged) {
            this.selectedRegionIds.clear();
            this.regionColors.clear();
        }
        this.lastRenderedMissionId = data.missionId || null;

        const bounds = data.bounds;
        if (!bounds) {
            this.setMapOverlay('Bounds unavailable.', { preserve: false });
            if (updateRegions) {
                const regions = Array.isArray(data.regions) ? data.regions : [];
                this.renderRegionList(regions);
            }
            this.syncRegionControls();
            return;
        }

        this.hideMapOverlay();
        this.clearMapSurface();

        const ctx = this.mapCtx;
        const width = this.mapCanvas.width;
        const height = this.mapCanvas.height;
        const padding = 24;

        const spanX = bounds.maxX - bounds.minX || 1;
        const spanY = bounds.maxY - bounds.minY || 1;
        const scale = Math.min(
            (width - padding * 2) / spanX,
            (height - padding * 2) / spanY
        );

        const groups = this.groupPointsByRegion(data.points);
        const highlightedRegions = this.getHighlightedRegionIds();
        const hasHighlights = highlightedRegions.size > 0;

        groups.forEach((group) => {
            if (!group.points.length) {
                return;
            }

            const color = this.getRegionColor(group.key);
            const highlighted = hasHighlights ? highlightedRegions.has(group.key) : false;

            ctx.save();
            ctx.strokeStyle = color;
            ctx.lineWidth = hasHighlights ? (highlighted ? 3 : 1.5) : 2;
            ctx.globalAlpha = highlighted || !hasHighlights ? 1 : 0.65;
            ctx.lineJoin = 'round';
            ctx.lineCap = 'round';
            ctx.beginPath();

            group.points.forEach((point, index) => {
                const projected = this.mapPointToCanvas(point, bounds, scale, padding, height);
                if (index === 0) {
                    ctx.moveTo(projected.x, projected.y);
                } else {
                    ctx.lineTo(projected.x, projected.y);
                }
            });

            ctx.stroke();
            ctx.restore();
        });

        const firstPoint = this.mapPointToCanvas(data.points[0], bounds, scale, padding, height);
        const lastPoint = this.mapPointToCanvas(data.points[data.points.length - 1], bounds, scale, padding, height);

        this.drawPointMarker(firstPoint, '#28a745');
        this.drawPointMarker(lastPoint, '#dc3545');

        const finalSample = data.points[data.points.length - 1];
        if (finalSample && Number.isFinite(finalSample.theta)) {
            this.drawHeadingArrow(lastPoint, finalSample.theta);
        }

        if (updateRegions) {
            const regions = Array.isArray(data.regions) ? data.regions : [];
            this.renderRegionList(regions);
        }

        if (this.mapMeta) {
            const label = this.formatMissionLabel(data);
            const updatedAt = new Date().toLocaleTimeString();
            const pointTotal = Number.isFinite(data.pointCount) ? data.pointCount : data.points.length;
            const regionCount = Array.isArray(data.regions) ? data.regions.length : 0;
            const regionSuffix = regionCount ? ` · ${regionCount} region${regionCount === 1 ? '' : 's'}` : '';
            this.mapMeta.textContent = `${label} · ${pointTotal} points${regionSuffix} · Updated ${updatedAt}`;
        }

        this.syncRegionControls();
    }

    groupPointsByRegion(points) {
        const groups = [];
        if (!Array.isArray(points)) {
            return groups;
        }

        let currentGroup = null;
        points.forEach((point) => {
            const key = this.getPointKey(point);
            if (!currentGroup || currentGroup.key !== key) {
                currentGroup = { key, points: [] };
                groups.push(currentGroup);
            }
            currentGroup.points.push(point);
        });

        return groups;
    }

    getPointKey(point) {
        if (!point || typeof point !== 'object') {
            return 'default';
        }

        if (point.regionId !== undefined && point.regionId !== null) {
            return String(point.regionId);
        }

        if (point.segmentId !== undefined && point.segmentId !== null) {
            return String(point.segmentId);
        }

        return 'default';
    }

    assignRegionColor(key) {
        if (!key || this.regionColors.has(key)) {
            return;
        }

        const paletteIndex = this.regionColors.size % this.regionPalette.length;
        const candidate = this.regionPalette[paletteIndex];
        this.regionColors.set(key, candidate);
    }

    getRegionColor(key) {
        const normalizedKey = key || 'default';
        if (normalizedKey === 'default' && !this.regionColors.has('default')) {
            this.regionColors.set('default', '#94a3b8');
        }
        if (!this.regionColors.has(normalizedKey)) {
            this.assignRegionColor(normalizedKey);
        }
        return this.regionColors.get(normalizedKey) || '#667eea';
    }

    getHighlightedRegionIds() {
        const set = new Set(this.selectedRegionIds || []);
        if (this.activeTargetedClean && Array.isArray(this.activeTargetedClean.regionIds)) {
            this.activeTargetedClean.regionIds.forEach((id) => {
                if (id !== undefined && id !== null) {
                    set.add(String(id));
                }
            });
        }
        return set;
    }

    mapPointToCanvas(point, bounds, scale, padding, canvasHeight) {
        return {
            x: padding + (point.x - bounds.minX) * scale,
            y: canvasHeight - (padding + (point.y - bounds.minY) * scale)
        };
    }

    markMapStale() {
        if (this.pendingMapRefresh) {
            clearTimeout(this.pendingMapRefresh);
            this.pendingMapRefresh = null;
        }
        this.mapDataTimestamp = 0;
        this.syncRegionControls();
    }

    isMapFresh() {
        if (!this.mapData || !this.mapDataTimestamp) {
            return false;
        }
        return Date.now() - this.mapDataTimestamp < this.roomMetadataStaleMs;
    }

    drawPointMarker(position, color) {
        if (!this.mapCtx) {
            return;
        }

        const ctx = this.mapCtx;
        ctx.save();
        ctx.fillStyle = color;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(position.x, position.y, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
    }

    drawHeadingArrow(position, thetaDegrees) {
        if (!this.mapCtx) {
            return;
        }

        const ctx = this.mapCtx;
        const radians = (thetaDegrees * Math.PI) / 180;
        const length = 24;
        const dx = Math.cos(radians) * length;
        const dy = Math.sin(radians) * length;

        ctx.save();
        ctx.strokeStyle = '#17a2b8';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(position.x, position.y);
        ctx.lineTo(position.x + dx, position.y - dy);
        ctx.stroke();
        ctx.restore();
    }

    renderRegionList(regions) {
        if (!this.roomList) {
            return;
        }

        this.roomList.innerHTML = '';

        if (!Array.isArray(regions) || regions.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'room-empty';
            empty.textContent = 'No rooms discovered yet.';
            this.roomList.appendChild(empty);
            this.pruneSelectedRegions(new Set());
            this.syncRegionControls();
            return;
        }

        const fragment = document.createDocumentFragment();
        const validIds = new Set();

        const activeSet = this.activeTargetedClean && Array.isArray(this.activeTargetedClean.regionIds)
            ? new Set(this.activeTargetedClean.regionIds.map((id) => String(id)))
            : null;

        regions.forEach((region) => {
            const normalized = this.normalizeRegion(region);
            if (!normalized || validIds.has(normalized.id)) {
                return;
            }

            validIds.add(normalized.id);
            this.getRegionColor(normalized.id);

            const displayName = this.getRegionDisplayName(normalized);

            const item = document.createElement('div');
            item.className = 'room-item';

            const labelWrapper = document.createElement('label');
            labelWrapper.className = 'room-label';

            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.dataset.regionId = normalized.id;
            checkbox.checked = this.selectedRegionIds.has(normalized.id);

            const colorDot = document.createElement('span');
            colorDot.className = 'room-color-dot';
            colorDot.style.backgroundColor = this.getRegionColor(normalized.id);

            const nameSpan = document.createElement('span');
            nameSpan.textContent = displayName;

            labelWrapper.appendChild(checkbox);
            labelWrapper.appendChild(colorDot);
            labelWrapper.appendChild(nameSpan);

            const actions = document.createElement('div');
            actions.className = 'room-actions';

            const tag = document.createElement('span');
            tag.className = 'room-tag';
            tag.textContent = normalized.type.toUpperCase();

            const renameBtn = document.createElement('button');
            renameBtn.type = 'button';
            renameBtn.className = 'room-rename-btn';
            renameBtn.dataset.action = 'rename';
            renameBtn.dataset.regionId = normalized.id;
            renameBtn.dataset.currentName = displayName;
            renameBtn.textContent = 'Rename';

            actions.appendChild(tag);
            actions.appendChild(renameBtn);

            item.appendChild(labelWrapper);
            item.appendChild(actions);

            if (checkbox.checked) {
                item.classList.add('selected');
            }

            if (activeSet && activeSet.has(normalized.id)) {
                item.classList.add('active-clean');
            }

            fragment.appendChild(item);
        });

        if (!validIds.size) {
            const empty = document.createElement('div');
            empty.className = 'room-empty';
            empty.textContent = 'No rooms discovered yet.';
            fragment.appendChild(empty);
        }

        this.roomList.appendChild(fragment);
        this.pruneSelectedRegions(validIds);
        this.syncRegionControls();
    }

    normalizeRegion(region) {
        if (!region) {
            return null;
        }

        if (typeof region === 'string') {
            return {
                id: region,
                type: 'rid',
                name: `Region ${region}`
            };
        }

        const rawId = region.id ?? region.region_id ?? region.regionId;
        if (rawId === undefined || rawId === null) {
            return null;
        }

        const id = String(rawId);
        const type = region.type || 'rid';
        const fallbackName = type === 'segment' ? `Segment ${id}` : `Region ${id}`;
        const name = region.name || region.label || fallbackName;

        return {
            id,
            type,
            name,
            params: region.params && typeof region.params === 'object' ? region.params : undefined
        };
    }

    getRegionDisplayName(region) {
        if (!region) {
            return '';
        }
        const override = this.roomNameOverrides.get(region.id);
        return override || region.name;
    }

    getRegionsForDisplay() {
        if (this.mapData && Array.isArray(this.mapData.regions) && this.mapData.regions.length) {
            return this.mapData.regions;
        }
        if (this.state && Array.isArray(this.state.regions) && this.state.regions.length) {
            return this.state.regions;
        }
        return [];
    }

    loadStoredRoomNames() {
        if (typeof localStorage === 'undefined') {
            return;
        }
        try {
            const raw = localStorage.getItem('vac_room_name_overrides');
            if (!raw) {
                return;
            }
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === 'object') {
                Object.entries(parsed).forEach(([key, value]) => {
                    if (value && typeof value === 'string') {
                        this.roomNameOverrides.set(key, value);
                    }
                });
            }
        } catch (error) {
            console.warn('Failed to load room name overrides:', error.message);
        }
    }

    persistRoomNames() {
        if (typeof localStorage === 'undefined') {
            return;
        }
        const entries = Object.fromEntries(this.roomNameOverrides.entries());
        try {
            localStorage.setItem('vac_room_name_overrides', JSON.stringify(entries));
        } catch (error) {
            console.warn('Failed to persist room name overrides:', error.message);
        }
    }

    setRegionOverride(regionId, name) {
        if (!regionId) {
            return;
        }
        const trimmed = typeof name === 'string' ? name.trim() : '';
        if (trimmed) {
            this.roomNameOverrides.set(regionId, trimmed);
        } else {
            this.roomNameOverrides.delete(regionId);
        }
        this.persistRoomNames();
        this.refreshActiveCleanNames();
    }

    lookupRegionName(regionId) {
        if (!regionId) {
            return '';
        }
        const id = String(regionId);
        const override = this.roomNameOverrides.get(id);
        if (override) {
            return override;
        }
        const regions = this.getRegionsForDisplay();
        const match = regions.find((region) => {
            const normalized = this.normalizeRegion(region);
            return normalized && normalized.id === id;
        });
        if (match) {
            const normalized = this.normalizeRegion(match);
            return normalized ? normalized.name : id;
        }
        return id;
    }

    normalizeRegionIdList(ids) {
        if (!Array.isArray(ids)) {
            return [];
        }
        const ordered = [];
        const seen = new Set();
        ids.forEach((value) => {
            if (value === undefined || value === null) {
                return;
            }
            const id = String(value);
            if (!seen.has(id)) {
                seen.add(id);
                ordered.push(id);
            }
        });
        return ordered;
    }

    areRegionIdSetsEqual(a, b) {
        if (!Array.isArray(a) || !Array.isArray(b)) {
            return false;
        }
        if (a.length !== b.length) {
            return false;
        }
        const setA = new Set(a.map((value) => String(value)));
        if (setA.size !== a.length) {
            return false;
        }
        for (let i = 0; i < b.length; i += 1) {
            if (!setA.has(String(b[i]))) {
                return false;
            }
        }
        return true;
    }

    normalizeRegionCollection(collection) {
        if (!Array.isArray(collection) || !collection.length) {
            return [];
        }
        const extracted = collection.map((entry) => {
            if (entry === undefined || entry === null) {
                return null;
            }
            if (typeof entry === 'string' || typeof entry === 'number') {
                return entry;
            }
            if (typeof entry === 'object') {
                const candidate = entry.region_id ?? entry.regionId ?? entry.id ?? entry.rid ?? entry.hrid ?? entry.uid;
                if (candidate !== undefined && candidate !== null) {
                    return candidate;
                }
            }
            return null;
        });
        return this.normalizeRegionIdList(extracted);
    }

    extractMissionTargetRegions(state) {
        const mission = state && state.mission ? state.mission : null;
        if (!mission || typeof mission !== 'object') {
            return [];
        }

        const cycle = typeof mission.cycle === 'string' ? mission.cycle.toLowerCase() : '';
        const targetedCycles = new Set(['room', 'rooms', 'spot', 'quick']);
        const cycleSuggestsTargeted = targetedCycles.has(cycle);

        const candidateKeys = cycleSuggestsTargeted
            ? ['regions', 'orderedRegions', 'targetRegions', 'activeRegions', 'regionList', 'runRegions']
            : ['orderedRegions', 'targetRegions', 'activeRegions', 'regionList', 'runRegions'];

        for (let i = 0; i < candidateKeys.length; i += 1) {
            const key = candidateKeys[i];
            const normalized = this.normalizeRegionCollection(mission[key]);
            if (normalized.length) {
                return normalized;
            }
        }

        if (cycleSuggestsTargeted && Array.isArray(mission.mapSegs) && mission.mapSegs.length && mission.mapSegs.length <= 10) {
            const normalizedSegs = this.normalizeRegionIdList(mission.mapSegs);
            if (normalizedSegs.length) {
                return normalizedSegs;
            }
        }

        if (cycleSuggestsTargeted && Array.isArray(mission.roomStates)) {
            const fromRoomStates = this.normalizeRegionCollection(
                mission.roomStates.map((room) => (room ? (room.region_id ?? room.regionId ?? room.id ?? null) : null))
            );
            if (fromRoomStates.length) {
                return fromRoomStates;
            }
        }

        return [];
    }

    refreshActiveCleanNames() {
        if (!this.activeTargetedClean || !Array.isArray(this.activeTargetedClean.regionIds)) {
            return;
        }
        this.activeTargetedClean.regionNames = this.activeTargetedClean.regionIds.map((id) => this.lookupRegionName(id));
        this.syncRegionControls();
    }

    setActiveTargetedClean(regionIds) {
        if (this.activeCleanClearTimer) {
            clearTimeout(this.activeCleanClearTimer);
            this.activeCleanClearTimer = null;
        }

        if (!Array.isArray(regionIds) || !regionIds.length) {
            if (this.activeCleanClearTimer) {
                clearTimeout(this.activeCleanClearTimer);
                this.activeCleanClearTimer = null;
            }
            this.activeTargetedClean = null;
            this.syncRegionControls();
            return;
        }
        const normalized = this.normalizeRegionIdList(regionIds);
        if (!normalized.length) {
            if (this.activeCleanClearTimer) {
                clearTimeout(this.activeCleanClearTimer);
                this.activeCleanClearTimer = null;
            }
            this.activeTargetedClean = null;
            this.syncRegionControls();
            return;
        }

        const canReuse = this.activeTargetedClean
            && !this.activeTargetedClean.completedAt
            && this.areRegionIdSetsEqual(this.activeTargetedClean.regionIds, normalized);

        if (canReuse) {
            this.activeTargetedClean.regionIds = normalized;
            this.activeTargetedClean.regionNames = normalized.map((id) => this.lookupRegionName(id));
            this.syncRegionControls();
            return;
        }

        const names = normalized.map((id) => this.lookupRegionName(id));

        this.activeTargetedClean = {
            regionIds: normalized,
            regionNames: names,
            requestedAt: Date.now(),
            startedAt: null,
            completedAt: null
        };

        this.syncRegionControls();

        if (!this.activeTargetedClean.startedAt) {
            this.scheduleActiveCleanClear(this.pendingTargetedCleanTimeoutMs);
        }

        if (this.mapData) {
            this.drawMap(this.mapData, { skipResize: true, updateRegions: false });
        }
    }

    scheduleActiveCleanClear(delayMs = 15000) {
        if (this.activeCleanClearTimer) {
            clearTimeout(this.activeCleanClearTimer);
        }

        const duration = Number.isFinite(delayMs) && delayMs > 0 ? delayMs : 15000;

        this.activeCleanClearTimer = setTimeout(() => {
            this.activeCleanClearTimer = null;
            const previous = this.activeTargetedClean;
            this.activeTargetedClean = null;
            this.syncRegionControls();
            if (this.mapData) {
                this.drawMap(this.mapData, { skipResize: true, updateRegions: false });
            }
            if (previous && !previous.startedAt) {
                this.log('Targeted clean request timed out before starting. Robot may be busy or paused.', 'warn');
            }
        }, duration);
    }

    updateActiveCleanTracking(state) {
        const missionRegions = this.extractMissionTargetRegions(state);
        if (missionRegions.length) {
            this.setActiveTargetedClean(missionRegions);
        }

        if (!this.activeTargetedClean) {
            return;
        }

        if (state && state.cleaning) {
            if (!this.activeTargetedClean.startedAt) {
                this.activeTargetedClean.startedAt = Date.now();
                this.syncRegionControls();
            }
            if (this.activeCleanClearTimer) {
                clearTimeout(this.activeCleanClearTimer);
                this.activeCleanClearTimer = null;
            }
            return;
        }

        if (this.activeTargetedClean.startedAt && !this.activeTargetedClean.completedAt) {
            this.activeTargetedClean.completedAt = Date.now();
            const summary = this.activeTargetedClean.regionNames.join(', ');
            if (summary) {
                this.log(`Targeted clean finished for ${summary}.`, 'success');
            }
            this.syncRegionControls();
            this.scheduleActiveCleanClear();
        }
    }

    pruneSelectedRegions(validIds) {
        if (!(validIds instanceof Set)) {
            return;
        }

        let removed = false;
        this.selectedRegionIds.forEach((id) => {
            if (!validIds.has(id)) {
                this.selectedRegionIds.delete(id);
                removed = true;
            }
        });

        if (removed && this.mapData) {
            this.drawMap(this.mapData, { skipResize: true, updateRegions: false });
        }
    }

    handleRoomListChange(event) {
        const target = event.target;
        if (!target || target.tagName !== 'INPUT') {
            return;
        }

        const regionId = target.dataset.regionId;
        if (!regionId) {
            return;
        }

        if (target.checked) {
            this.selectedRegionIds.add(regionId);
        } else {
            this.selectedRegionIds.delete(regionId);
        }

        const wrapper = target.closest('.room-item');
        if (wrapper) {
            if (target.checked) {
                wrapper.classList.add('selected');
            } else {
                wrapper.classList.remove('selected');
            }
        }

        this.syncRegionControls();

        if (this.mapData) {
            this.drawMap(this.mapData, { skipResize: true, updateRegions: false });
        }
    }

    handleRoomListClick(event) {
        const button = event.target.closest('button[data-action="rename"]');
        if (!button) {
            return;
        }

        event.preventDefault();
        const regionId = button.dataset.regionId;
        if (!regionId) {
            return;
        }

        const currentName = button.dataset.currentName || regionId;
        const proposed = window.prompt('Enter a name for this area', currentName);
        if (proposed === null) {
            return;
        }

        this.setRegionOverride(regionId, proposed);

        const regions = this.getRegionsForDisplay();
        if (regions.length) {
            this.renderRegionList(regions);
        }

        if (this.mapData) {
            this.drawMap(this.mapData, { skipResize: true, updateRegions: false });
        } else {
            this.syncRegionControls();
        }
    }

    syncRegionControls() {
        const hasRegions = this.mapData && Array.isArray(this.mapData.regions) && this.mapData.regions.length;
        const mapFresh = this.isMapFresh();
        const metadataReady = hasRegions && mapFresh;
        const hasAnySelection = this.selectedRegionIds.size > 0;
        const hasSelection = metadataReady && hasAnySelection;
        const canSend = hasSelection && this.connected;

        if (this.cleanRoomsBtn) {
            this.cleanRoomsBtn.disabled = !canSend;
            this.cleanRoomsBtn.title = !metadataReady
                ? 'Room metadata is stale or unavailable. Wait for the latest map.'
                : '';
        }

        if (this.clearRoomsBtn) {
            this.clearRoomsBtn.disabled = !hasAnySelection;
        }

        if (this.roomOrderToggle) {
            this.roomOrderToggle.disabled = !metadataReady || this.selectedRegionIds.size <= 1;
        }

        if (this.roomStaleness) {
            if (!this.connected) {
                this.roomStaleness.textContent = 'Connect to the robot to refresh room metadata.';
                this.roomStaleness.classList.remove('hidden');
            } else if (hasRegions && !mapFresh) {
                this.roomStaleness.textContent = 'Room metadata is out of date. Refreshing...';
                this.roomStaleness.classList.remove('hidden');
            } else {
                this.roomStaleness.classList.add('hidden');
            }
        }

        if (this.roomStatus) {
            let message = '';
            let markActive = false;
            let markCompleted = false;

            if (this.activeTargetedClean && Array.isArray(this.activeTargetedClean.regionIds) && this.activeTargetedClean.regionIds.length) {
                const names = Array.isArray(this.activeTargetedClean.regionNames) && this.activeTargetedClean.regionNames.length
                    ? this.activeTargetedClean.regionNames
                    : this.activeTargetedClean.regionIds;
                const summary = names.join(', ');

                if (this.activeTargetedClean.completedAt) {
                    message = `Completed targeted clean for ${summary}.`;
                    markCompleted = true;
                } else if (this.activeTargetedClean.startedAt) {
                    message = `Targeted cleaning ${summary}...`;
                    markActive = true;
                } else {
                    message = `Targeted clean requested for ${summary}. Waiting for robot to start...`;
                    markActive = true;
                }
            } else if (!this.connected) {
                message = 'Connect to a robot to enable targeted cleaning.';
            } else if (!hasRegions) {
                message = 'No mapped rooms yet. Start a full clean to capture room metadata.';
            } else if (!mapFresh) {
                message = 'Waiting for the latest room map to finish syncing...';
            } else if (!hasAnySelection) {
                message = 'Select rooms from the list to start a targeted clean.';
            }

            if (message) {
                this.roomStatus.textContent = message;
                this.roomStatus.classList.remove('hidden');
                if (markActive) {
                    this.roomStatus.classList.add('active');
                } else {
                    this.roomStatus.classList.remove('active');
                }
                if (markCompleted) {
                    this.roomStatus.classList.add('completed');
                } else {
                    this.roomStatus.classList.remove('completed');
                }
            } else {
                this.roomStatus.classList.add('hidden');
                this.roomStatus.classList.remove('active');
                this.roomStatus.classList.remove('completed');
            }
        }
    }

    clearRegionSelection() {
        if (!this.selectedRegionIds.size) {
            return;
        }

        this.selectedRegionIds.clear();

        if (this.roomList) {
            const checkboxes = this.roomList.querySelectorAll('input[type="checkbox"][data-region-id]');
            checkboxes.forEach((checkbox) => {
                checkbox.checked = false;
                const wrapper = checkbox.closest('.room-item');
                if (wrapper) {
                    wrapper.classList.remove('selected');
                }
            });
        }

        this.syncRegionControls();

        if (this.mapData) {
            this.drawMap(this.mapData, { skipResize: true, updateRegions: false });
        }
    }

    async cleanSelectedRegions() {
        if (!this.selectedRegionIds.size) {
            return;
        }

        const regions = Array.from(this.selectedRegionIds).map((id) => ({ region_id: id }));
        const ordered = this.roomOrderToggle ? !!this.roomOrderToggle.checked : true;

        const payload = {
            regions,
            ordered
        };

        if (this.mapData && this.mapData.mapId) {
            payload.mapId = this.mapData.mapId;
        }

        if (!payload.mapId && this.state && this.state.mapId) {
            payload.mapId = this.state.mapId;
        }

        if (this.state && this.state.userPmapvId) {
            payload.userPmapvId = this.state.userPmapvId;
        }

        const button = this.cleanRoomsBtn;
        const originalText = button ? button.textContent : '';

        try {
            if (button) {
                button.disabled = true;
                button.textContent = 'Sending...';
            }

            const response = await fetch('/api/cleanRooms', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            const data = await response.json();

            if (!response.ok) {
                const message = data && data.error ? data.error : 'Targeted clean failed';
                const statusText = `${response.status} ${response.statusText || ''}`.trim();
                throw new Error(`${message}${statusText ? ` (${statusText})` : ''}`);
            }

            const regionIds = regions.map((region) => region.region_id);
            const humanNames = regionIds.map((id) => this.lookupRegionName(id));
            const summary = humanNames.length ? humanNames.join(', ') : regionIds.join(', ');

            this.setActiveTargetedClean(regionIds);

            this.log(
                `Targeted clean started for ${regionIds.length} area(s): ${summary || 'n/a'}.`,
                'success'
            );
        } catch (error) {
            this.log(`Targeted clean failed: ${error.message}`, 'error');
            alert(`Targeted clean failed: ${error.message}`);
        } finally {
            if (button) {
                button.textContent = originalText || 'Clean Selected Areas';
            }
            this.syncRegionControls();
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
    }
}

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    new RoombaApp();
});
