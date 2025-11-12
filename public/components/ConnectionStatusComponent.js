import { BaseComponent } from './BaseComponent.js';

export class ConnectionStatusComponent extends BaseComponent {
    constructor(opts = {}) {
        super(opts);
        this.indicator = document.getElementById('statusIndicator');
        this.text = document.getElementById('statusText');
    }

    bind() {
        this.subscribe('connectionStatus', (connected) => {
            if (!this.indicator || !this.text) return;
            if (connected) {
                this.indicator.classList.add('connected');
                this.text.textContent = 'Connected';
            } else {
                this.indicator.classList.remove('connected');
                this.text.textContent = 'Not Connected';
            }
        });
    }
}
