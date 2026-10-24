# Shortcut developer docs

Shortcut is an iOS indoor-navigation app: React/Vite UI in a Capacitor shell, a pure TypeScript routing/positioning core, and ESP32 BLE beacons.

Position data flows through one authority: BLE scans call `PositionEngine.onBeacon`, accelerometer-confirmed steps with compass/gyro headings call `PositionEngine.onStep`, and manual map anchors call `PositionEngine.setAnchor`/`setPoint`. The engine emits corridor-snapped positions and navigation state to `App`, which renders them without owning positioning logic.

## Index
- [building-data.md](building-data.md) — map schema, coordinates, scale, and beacon placement
- [lib.md](lib.md) — pure routing, PDR, BLE selection, and fusion math
- [positioning.md](positioning.md) — engine and device adapters
- [app.md](app.md) — React UI, map rendering, and configuration
- [firmware.md](firmware.md) — ESP32 firmware architecture
- [tools.md](tools.md) — floor-plan tracing utility

See the project [README](../README.md) for setup, iOS, flashing, and the calibration protocol.
