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
        this.handleResize = this.handleResize.bind(this);
        
        this.initializeElements();
        this.attachEventListeners();
        this.setupCanvas();
        this.connectWebSocket();
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
    }

    attachEventListeners() {
        this.discoverBtn.addEventListener('click', () => this.discoverRoombas());
        this.connectBtn.addEventListener('click', () => this.connect());
        this.disconnectBtn.addEventListener('click', () => this.disconnect());
        
        this.startBtn.addEventListener('click', () => this.sendCommand('start'));
        this.pauseBtn.addEventListener('click', () => this.sendCommand('pause'));
        this.stopBtn.addEventListener('click', () => this.sendCommand('stop'));
        this.dockBtn.addEventListener('click', () => this.sendCommand('dock'));
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
            case 'error':
                this.log(`Error: ${message.message}`, 'error');
                break;
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
        }
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
            this.position.textContent = `x: ${state.position.x.toFixed(0)}, y: ${state.position.y.toFixed(0)}`;
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
        if (!this.mapCanvas || this.mapFetchInFlight) {
            return;
        }

        const now = Date.now();
        if (!force && now - this.lastMapFetch < 5000) {
            return;
        }

        this.mapFetchInFlight = true;
        this.setMapOverlay(force ? 'Loading map…' : 'Updating map…', { preserve: !!this.mapData });

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

        this.mapData = data;

        if (!data || !Array.isArray(data.points) || data.points.length === 0) {
            this.setMapOverlay('Path data not available yet.', { preserve: false });
            if (this.mapMeta) {
                const label = this.formatMissionLabel(data);
                this.mapMeta.textContent = `${label} · 0 points`;
            }
            return;
        }

        const bounds = data.bounds;
        if (!bounds) {
            this.setMapOverlay('Bounds unavailable.', { preserve: false });
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

        ctx.save();
        ctx.strokeStyle = '#667eea';
        ctx.lineWidth = 2;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.beginPath();

        data.points.forEach((point, index) => {
            const projected = this.mapPointToCanvas(point, bounds, scale, padding, height);
            if (index === 0) {
                ctx.moveTo(projected.x, projected.y);
            } else {
                ctx.lineTo(projected.x, projected.y);
            }
        });

        ctx.stroke();
        ctx.restore();

        const firstPoint = this.mapPointToCanvas(data.points[0], bounds, scale, padding, height);
        const lastPoint = this.mapPointToCanvas(data.points[data.points.length - 1], bounds, scale, padding, height);

        this.drawPointMarker(firstPoint, '#28a745');
        this.drawPointMarker(lastPoint, '#dc3545');

        const finalSample = data.points[data.points.length - 1];
        if (finalSample && Number.isFinite(finalSample.theta)) {
            this.drawHeadingArrow(lastPoint, finalSample.theta);
        }

        if (this.mapMeta) {
            const label = this.formatMissionLabel(data);
            const updatedAt = new Date().toLocaleTimeString();
            this.mapMeta.textContent = `${label} · ${data.pointCount} points · Updated ${updatedAt}`;
        }
    }

    mapPointToCanvas(point, bounds, scale, padding, canvasHeight) {
        return {
            x: padding + (point.x - bounds.minX) * scale,
            y: canvasHeight - (padding + (point.y - bounds.minY) * scale)
        };
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
