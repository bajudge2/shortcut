# Prompt to paste into Kiro (new chat in this repo)

You're helping me finish **Shortcut**, an indoor navigation app for a hackathon (about <HOURS> hours left).
Read `README.md` and `.kiro/steering/project.md` first; they describe the architecture and rules.

## What exists
- React + Vite + TypeScript UI wrapped with Capacitor for iOS (we all have iPhones and one Mac).
- Positioning: ESP32 BLE beacons (nearest-beacon with RSSI smoothing), manual "I'm here" taps, and step-counting dead reckoning, all feeding `PositionEngine` (`src/positioning/engine.ts`).
- Routing: Dijkstra over a node/edge graph in `src/data/building.json`, accessible-route toggle, turn-by-turn text.
- Pure logic in `src/lib` is tested: `npm run test:logic` (18 passing). The UI, BLE, and motion adapters were written without being run (the authoring sandbox had no npm or Xcode access), so expect to debug them.
- Hardware: 3 ESP32 boards, firmware in `firmware/esp32_beacon`.

## Do these in order
1. Run `npm install`, `npm run typecheck`, `npm run test:logic`, then start the dev server. Fix any type or build errors (likely spots: `src/components/*`, `src/positioning/ble.ts`, Capacitor/Leaflet typings). Don't change behavior unless something is broken.
2. Replace the demo map in `src/data/building.json` with our real building. I'll provide floor plan images and measurements; add nodes/edges/beacons, set `metersPerUnit` and `northOffsetDeg`. Keep the data-consistency test passing.
3. Get `npx cap add ios`, the Info.plist permission strings, and signing working so the app runs on my iPhone (README section 2).
4. Flash the 3 ESP32s, verify the Debug panel shows live RSSI for B1 to B3 on the phone, then tune `src/lib/beacon-math.ts` (alpha, hysteresis, minRssi) so the nearest-beacon fix is stable while walking.
5. Verify the step-counting dot on a real walk; tune the step threshold / step length in `src/lib/pdr-math.ts` and `src/config.ts`.
6. Polish for the demo: search UX, a clear "you are here" state, arrival message, and a "relocate" prompt when the BLE signal is lost.

## Rules
- Keep `src/lib/*` pure and tested; add tests when changing it.
- Position logic goes through `PositionEngine` only, never in components.
- Manual "I'm here" must always work as a fallback if BLE misbehaves during the demo.
- Make small commits; tell me before adding new dependencies.
