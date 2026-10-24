# Shortcut

Google-Maps-style indoor navigation for UMass Lowell students. Pick where you're going, and Shortcut
routes you to the room with turn-by-turn directions, tracking you with ESP32 Bluetooth beacons and
your phone's step counter.

**Challenge track:** Better Together: Improving Where We Live, Work, Study & Play.
Campus buildings are hard to navigate and official floor plans aren't available, so we built the
map ourselves from the posted wall signs and placed our own beacons.

## How it works

- **Map:** a hand-built node/edge graph drawn over a photo of the building's wall map
  (`shortcut/src/data/building.json`, `shortcut/public/plans/`). Routes use Dijkstra.
- **Positioning:** three ESP32 boards advertise as `CNAV-B1..B3`. When you're at a board, the dot
  snaps to it. Between boards, the phone's accelerometer, gyroscope and compass move the dot along
  the corridors. "I'm at…" is always available as a manual fallback.
- **App:** React + Vite + TypeScript, wrapped with Capacitor as a native iOS app (Bluetooth needs a
  real iPhone; the map, routing and simulation also run in a browser).

## Current demo: Building A, floor 2

```
Club Hub (A-240)          ← B1
      │
Restrooms & Elevators
      │
A-255 ── crossroads ─────────────── Student Engagement (A-220)   ← B3
 ↑ B2
```

1. Stand at Club Hub with Bluetooth and Steps on. B1 sets your start.
2. Where to → A-255: "Turn right at the intersection". B2 confirms when you reach the door.
3. Where to → Student Engagement: walk back past the crossroads. B3 confirms on arrival.

## Repo layout

| Path | What's there |
|---|---|
| `shortcut/` | The app, firmware and tests. Setup and build steps are in [`shortcut/README.md`](shortcut/README.md). |
| `shortcut/firmware/esp32_beacon/` | PlatformIO firmware for the beacons. |
| `shortcut/docs/` | Developer notes on positioning, the pure logic library and the app. |
| `.kiro/` | Kiro specs, steering and hooks used to plan and build the project. |

## Quick start

```bash
cd shortcut
npm install
npm run test:logic   # logic tests, plain Node
npm run dev          # browser preview (no Bluetooth)
```

Building for the iPhone and flashing the beacons are covered in [`shortcut/README.md`](shortcut/README.md).
