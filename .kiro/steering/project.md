---
inclusion: always
---

# Shortcut — project context

Paths below are relative to the app folder `shortcut/`, one level below the workspace root. Run npm scripts from there.

Indoor navigation ("Google Maps for a campus building") built for a hackathon.
iOS app = React + Vite + TypeScript web UI wrapped with Capacitor, plus ESP32 BLE beacons for positioning.

## Architecture (keep these boundaries)
- `src/data/building.json` — the ONLY place map data lives (floors, nodes, edges, beacons). Plan coords: x right, y DOWN, in plan units; `metersPerUnit` converts to meters.
- `src/lib/*` — pure TypeScript, no React/DOM/Capacitor imports. Covered by `npm run test:logic` (Node's built-in runner, no install needed). Keep it pure and keep the tests green.
- `src/positioning/engine.ts` — single source of truth for the user's position. Every source (QR, BLE, manual, steps) only calls `setAnchor`, `onBeacon`, `onStep`, `setPoint`. Never put positioning logic in components.
- `src/positioning/ble.ts` / `motion.ts` — device-only adapters (need a real iPhone).
- `src/components/*`, `src/App.tsx` — UI only.
- `firmware/esp32_beacon` — PlatformIO C++ project (Arduino framework), envs `esp32s3` / `esp32` / `esp32-wrover-e`. BLE local name `CNAV-<id>` + UUIDs in `src/protocol.h`, mirrored in `src/config.ts` (keep both in sync). Beacon id + calibration live in NVS and are set over BLE/serial, never hardcoded per board.

## Positioning model
Anchors give exact fixes (QR scan, nearest BLE beacon, manual tap). Between anchors, step counting + compass moves the dot, snapped to corridors. BLE is nearest-beacon with RSSI smoothing + hysteresis, NOT trilateration (only 3 beacons, RSSI is noisy).

## Conventions
- TypeScript strict. Relative imports in `src/lib` and `src/positioning` use explicit `.ts` extensions (needed by the Node test runner).
- iOS motion permission must be requested inside a user tap handler.
- Prefer small, demo-able increments; the hackathon demo must always work with QR + manual fallback even if BLE misbehaves.
