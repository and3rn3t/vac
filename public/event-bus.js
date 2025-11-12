// Simple global event bus for decoupling UI components from RoombaApp
// Usage: VacEventBus.on('event', handler); VacEventBus.emit('event', data);
// Handlers are invoked in registration order; errors are caught and logged to console.
// No external dependencies; kept intentionally minimal.

const VacEventBus = (function() {
    const handlers = new Map(); // eventName -> Set<fn>

    function on(event, fn) {
        if (!event || typeof fn !== 'function') return;
        let set = handlers.get(event);
        if (!set) {
            set = new Set();
            handlers.set(event, set);
        }
        set.add(fn);
        return () => off(event, fn);
    }

    function once(event, fn) {
        if (!event || typeof fn !== 'function') return;
        const offWrapper = on(event, (payload) => {
            try { fn(payload); } finally { offWrapper(); }
        });
        return offWrapper;
    }

    function off(event, fn) {
        if (!event) return;
        const set = handlers.get(event);
        if (!set) return;
        if (fn) {
            set.delete(fn);
        } else {
            set.clear();
        }
        if (!set.size) handlers.delete(event);
    }

    function emit(event, payload) {
        if (!event) return;
        const set = handlers.get(event);
        if (!set || !set.size) return;
        [...set].forEach(fn => {
            try { fn(payload); } catch (err) { console.error(`Event handler for '${event}' failed:`, err); }
        });
    }

    return { on, once, off, emit };
})();

window.VacEventBus = VacEventBus;
