import { BaseComponent } from './BaseComponent.js';

export class ActivityLogComponent extends BaseComponent {
    constructor(opts = {}) {
        super(opts);
        this.container = document.getElementById('logContainer');
        this.maxEntries = opts.maxEntries || 50;
    }

    bind() {
        this.subscribe('log', (entry) => {
            if (!this.container || !entry) return;
            const div = document.createElement('div');
            div.className = `log-entry ${entry.type || 'info'}`;
            div.textContent = `[${new Date().toLocaleTimeString()}] ${entry.message}`;
            this.container.insertBefore(div, this.container.firstChild);
            while (this.container.children.length > this.maxEntries) {
                this.container.removeChild(this.container.lastChild);
            }
        });
    }

    add(message, type = 'info') {
        window.VacEventBus.emit('log', { message, type });
    }
}
