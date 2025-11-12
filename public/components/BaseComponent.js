// Base class for lightweight DOM components using the global VacEventBus
// Extend and implement bind() and optionally render(); use this.subscribe(event, handler).

export class BaseComponent {
    constructor(options = {}) {
        this.id = options.id || null; // optional debug id
        this._unsubs = [];
        this.el = options.el || null; // root element reference
    }

    subscribe(event, handler) {
        const off = window.VacEventBus.on(event, handler);
        this._unsubs.push(off);
        return off;
    }

    bind() { /* override in subclass */ }
    render() { /* optional */ }

    destroy() {
        this._unsubs.forEach(fn => { try { fn(); } catch(_) {} });
        this._unsubs = [];
    }
}
