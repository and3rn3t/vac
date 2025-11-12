# Copilot Instructions

## Project Snapshot
- Node.js stack; entrypoint `server/index.js` serves REST, WebSocket, and static `public/` UI.
- `RoombaClient` MQTT bridge (server/roomba-client.js) drives robot control/state; events feed WebSocket broadcast.
- `RoombaDiscovery` (server/discovery.js) handles UDP 5678 network scans; results bubble up via `/api/discover`.
- Canonical protocol/API docs live in `API.md` and `PROTOCOL.md`; skim before changing command topics or payloads.
- `.env` (copy `.env.example`) carries `ROOMBA_*`, `MQTT_*`, and `PORT`; never hardcode secrets.
- Extra knobs: `LOG_LEVEL` controls verbosity (`error|warn|info|debug`), `MQTT_KEEPALIVE_SEC` / `MQTT_RECONNECT_MS` tune MQTT, and `DISCOVERY_TIMEOUT_MS` adjusts `/api/discover` duration (override per call with `timeoutMs`).

## Runtime & Tooling
 Automated tests exist (`node --test` via `npm test`) covering validation, state normalization, analytics, and scheduling (including recurring + updates). Keep them green; add tests alongside new features.

## Backend Patterns
 When adding features, update `README.md` / `SETUP.md` / `FEATURES.md` and scheduler/API docs in `API.md` if behavior or endpoints change so users stay unblocked.
- Extend robot capabilities via `RoombaClient.sendCommand(command, params)`; respect AWS-style topic strings and JSON payload structure.
## Scheduler Overview
- JSON-persisted schedules file at `var/schedules.json`.
- Endpoints: `GET/POST/PATCH/DELETE /api/schedules` with optional `intervalMs` for recurrence.
- WebSocket `type: "schedule"` events for lifecycle (`created|executing|executed|failed|canceled|updated`).
- Use `startServer()` / `stopServer()` helpers for integration tests; avoid auto-start by preserving `require.main === module` guard.
- Mission/battery/bin parsing happens inside `updateState`; keep derived fields there so UI and API share the same shape.
## CI
- GitHub Actions workflow `ci.yml` runs lint and tests on push/PR against `main`.
- Ensure changes pass `npm run lint` and `npm test` locally before pushing.

## Frontend Patterns
- Single-page script `public/app.js` instantiates `RoombaApp`; manipulate DOM through cached element refs instead of repeated `document.getElementById`.
- WebSocket reconnect logic lives in `connectWebSocket`; maintain the retry loop if altering connection handling.
- All REST calls use `fetch` against `/api/*` endpoints; make new UI features call server routes instead of MQTT directly.
- UI state updates flow through `updateState`/`updateConnectionStatus`; keep those centralized for consistency.

## Discovery & Protocol Notes
- UDP discovery broadcasts literal `iRobot` on 255.255.255.255:5678; respect this when tweaking discovery timing or payloads.
- MQTT defaults: port 8883 with TLS; override via `.env` (`MQTT_USE_TLS=false` toggles plain MQTT on 1883).
- `RoombaClient` subscribes to `$aws/things/{BLID}/shadow/update/{accepted|delta}`; reuse those topics for state listening.
- Commands publish to `cmd`; include `time` and `initiator: "localApp"` unless robot expects otherwise.

## Additional Context
- `requirements.txt` mirrors a legacy Python prototype—unused in this Node service; touch only if reviving Python tooling.
- Mobile shell under `mobile-app/` is aspirational; it currently lacks React Native scaffold beyond README guidance.
- When adding features, update `README.md` / `SETUP.md` if setup or networking steps change so users stay unblocked.
