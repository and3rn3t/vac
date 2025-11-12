import { BaseComponent } from './BaseComponent.js';

/**
 * ToastsComponent
 * Displays transient notifications for schedule events, errors, and successes.
 * Listens to:
 *  - log (severity mapped)
 *  - scheduleEvent (emits informative messages)
 * Configuration options:
 *  - maxToasts: maximum active toasts before oldest are removed
 *  - ttlMs: default time-to-live per toast (overridable per type)
 */
export class ToastsComponent extends BaseComponent {
    constructor(opts = {}) {
        super(opts);
        this.maxToasts = opts.maxToasts || 6;
        this.ttlMs = opts.ttlMs || 6000;
        this.container = null;
        this._idCounter = 0;
    }

    bind() {
        const host = this.el || document.getElementById(this.opts.id);
        if (!host) return;
        // Create container if not present
        this.container = document.createElement('div');
        this.container.className = 'toasts-container';
        host.appendChild(this.container);

        this.subscribe('log', (entry) => this.handleLog(entry));
        this.subscribe('scheduleEvent', (evt) => this.handleSchedule(evt));
        this.subscribe('connectionStatus', (connected) => {
            if (!connected) {
                this.pushToast({
                    message: 'Disconnected from server. Attempting reconnect...',
                    type: 'warn'
                });
            } else {
                this.pushToast({ message: 'Connected to server.', type: 'success', ttlMs: 3500 });
            }
        });
        this.subscribe('rawMessage', (msg) => {
            if (msg && msg.type === 'error') {
                // Surface error with retry action if known endpoint
                this.pushToast({ message: msg.message || 'Request failed', type: 'error' });
            }
        });
    }

    handleLog(entry) {
        if (!entry || typeof entry.message !== 'string') return;
        const type = entry.level || 'info';
        // Filter verbose info spam
        if (type === 'info' && /websocket connected/i.test(entry.message)) return;
        this.pushToast({ message: entry.message, type });
    }

    handleSchedule(evt) {
        if (!evt || evt.type !== 'schedule') return;
        const { event, schedule } = evt;
        const action = schedule && schedule.action ? schedule.action : 'action';
        let msg = null;
        let type = 'info';
        switch (event) {
            case 'created':
                msg = `Scheduled '${action}'.`; break;
            case 'executed':
                msg = `Schedule '${action}' complete.`; type = 'success'; break;
            case 'failed':
                msg = `Schedule '${action}' failed.`; type = 'error'; break;
            case 'canceled':
                msg = `Schedule '${action}' canceled.`; type = 'warn'; break;
            default:
                msg = `Schedule '${action}' ${event}.`; break;
        }
        if (msg) this.pushToast({ message: msg, type });
    }

    pushToast(opts) {
        if (!this.container || !opts || !opts.message) return;
        const id = ++this._idCounter;
        const type = opts.type || 'info';
        const ttl = Number.isFinite(opts.ttlMs) ? opts.ttlMs : this.ttlMs;
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.dataset.id = id;
        const body = document.createElement('div');
        body.className = 'toast-body';
        body.textContent = opts.message;
        const actionsWrap = document.createElement('div');
        actionsWrap.className = 'toast-actions';
        if (Array.isArray(opts.actions)) {
            opts.actions.slice(0, 2).forEach(act => {
                if (!act || typeof act.label !== 'string' || typeof act.onClick !== 'function') return;
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'btn btn-secondary btn-compact';
                btn.textContent = act.label;
                btn.addEventListener('click', (e) => { e.stopPropagation(); act.onClick(); this.removeToast(id); });
                actionsWrap.appendChild(btn);
            });
        }
        const close = document.createElement('button');
        close.type = 'button';
        close.className = 'toast-close';
        close.innerHTML = '&times;';
        close.addEventListener('click', () => this.removeToast(id));
        toast.appendChild(body);
        toast.appendChild(actionsWrap);
        toast.appendChild(close);
        this.container.appendChild(toast);
        requestAnimationFrame(() => {
            toast.classList.add('show');
        });
        if (this.container.childElementCount > this.maxToasts) {
            const first = this.container.firstElementChild;
            if (first) first.remove();
        }
        if (ttl > 0) {
            setTimeout(() => this.removeToast(id), ttl);
        }
    }

    removeToast(id) {
        if (!this.container) return;
        const el = this.container.querySelector(`.toast[data-id='${id}']`);
        if (!el) return;
        el.classList.remove('show');
        setTimeout(() => {
            el.remove();
        }, 250);
    }
}
