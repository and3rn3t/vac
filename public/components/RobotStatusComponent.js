import { BaseComponent } from './BaseComponent.js';

export class RobotStatusComponent extends BaseComponent {
    constructor(opts = {}) {
        super(opts);
        this.batteryLevel = document.getElementById('batteryLevel');
        this.batteryBar = document.getElementById('batteryBar');
        this.cleaningStatus = document.getElementById('cleaningStatus');
        this.binStatus = document.getElementById('binStatus');
        this.position = document.getElementById('position');
        this.missionProgress = document.getElementById('missionProgress');
        this.runtime = document.getElementById('runtime');
        this.areaCleaned = document.getElementById('areaCleaned');
    }

    bind() {
        this.subscribe('stateUpdate', (state) => this.render(state));
        // If app already has state when mounting, render immediately
        if (window.roombaApp && window.roombaApp.state) {
            this.render(window.roombaApp.state);
        }
    }

    render(state) {
        if (!state || typeof state !== 'object') return;

        // Battery
        if (this.batteryLevel && this.batteryBar && state.battery !== null && state.battery !== undefined) {
            const pct = Number(state.battery) || 0;
            this.batteryLevel.textContent = `${pct}%`;
            this.batteryBar.style.width = `${pct}%`;
            if (pct < 20) {
                this.batteryBar.style.background = '#dc3545';
            } else if (pct < 50) {
                this.batteryBar.style.background = '#ffc107';
            } else {
                this.batteryBar.style.background = 'linear-gradient(90deg, #28a745, #20c997)';
            }
        }

        // Cleaning status
        if (this.cleaningStatus && state.cleaning !== undefined) {
            this.cleaningStatus.textContent = state.cleaning ? 'Cleaning' : 'Idle';
            this.cleaningStatus.style.color = state.cleaning ? '#28a745' : '#666';
        }

        // Bin status
        if (this.binStatus && state.binFull !== undefined) {
            this.binStatus.textContent = state.binFull ? 'Full!' : 'OK';
            this.binStatus.style.color = state.binFull ? '#dc3545' : '#28a745';
        }

        // Position
        if (this.position && state.position) {
            const x = Number.isFinite(state.position.x) ? state.position.x : 0;
            const y = Number.isFinite(state.position.y) ? state.position.y : 0;
            const regionId = state.position.regionId || null;
            const segmentId = state.position.segmentId || null;
            const regionLabel = regionId ? ` · region ${regionId}` : (segmentId ? ` · segment ${segmentId}` : '');
            this.position.textContent = `x: ${x.toFixed(0)}, y: ${y.toFixed(0)}${regionLabel}`;
        }

        // Mission data
        const mission = state.mission || {};
        if (this.runtime && mission.mssnM !== undefined) {
            this.runtime.textContent = `${Math.floor(mission.mssnM / 60)}m ${mission.mssnM % 60}s`;
        }
        if (this.areaCleaned && mission.sqft !== undefined) {
            this.areaCleaned.textContent = `${mission.sqft} sq ft`;
        }
        if (this.missionProgress && mission.phase) {
            this.missionProgress.textContent = mission.phase;
        }
    }
}
