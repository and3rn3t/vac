// Initializes component scaffold after RoombaApp has set up WebSocket.
// Assumes app.js runs first to define RoombaApp; uses DOMContentLoaded sequencing.
import { ConnectionStatusComponent } from './components/ConnectionStatusComponent.js';
import { ActivityLogComponent } from './components/ActivityLogComponent.js';
import { ScheduleListComponent } from './components/ScheduleListComponent.js';
import { RobotStatusComponent } from './components/RobotStatusComponent.js';
import { RoomsComponent } from './components/RoomsComponent.js';
import { MapCanvasComponent } from './components/MapCanvasComponent.js';
import { ToastsComponent } from './components/ToastsComponent.js';
import { AnalyticsComponent } from './components/AnalyticsComponent.js';

function initComponents() {
    const connection = new ConnectionStatusComponent({ id: 'connection-status' });
    connection.bind();
    const log = new ActivityLogComponent({ id: 'activity-log', maxEntries: 60 });
    log.bind();
    const schedules = new ScheduleListComponent({ id: 'schedules' });
    schedules.bind();
    const status = new RobotStatusComponent({ id: 'robot-status' });
    status.bind();
    const rooms = new RoomsComponent({ id: 'rooms' });
    rooms.bind();
    const mapCanvas = new MapCanvasComponent({ id: 'map-canvas' });
    mapCanvas.bind();
    const toasts = new ToastsComponent({ id: 'toasts-root', maxToasts: 6 });
    toasts.bind();
    const analytics = new AnalyticsComponent({ id: 'analytics', range: '30d', bucket: '1d' });
    analytics.bind();
    // Expose for debugging
    window.vacComponents = { connection, log, schedules, status, rooms, mapCanvas, toasts, analytics };
}

document.addEventListener('DOMContentLoaded', () => {
    // RoombaApp is instantiated in app.js; we just scaffold components now.
    initComponents();
});
