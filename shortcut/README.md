# Shortcut

Indoor navigation for one campus building. An iOS app (React + Vite + TypeScript, wrapped with
Capacitor) that routes people to rooms, positioned by **ESP32 BLE beacons**, **QR codes**,
and **step counting** between them.

```
src/data/building.json   map data (floors, nodes, edges, beacons)  <- edit this for the real building
src/lib/                 routing (Dijkstra), directions, beacon smoothing, dead-reckoning math (pure, tested)
src/positioning/         engine (single source of truth) + BLE + motion-sensor adapters
src/components/          MapView (Leaflet, no tiles), QrScanner
firmware/esp32_beacon/   Arduino sketch for the beacons
tools/make-qr.mjs        printable QR sheet, one code per node
tests/                   logic tests (run with plain Node, no install needed)
```

## 1. First run (on the Mac)

Requires Node 22+ and a recent Xcode (Capacitor 8 expects a current Xcode; if yours is older, pin
`@capacitor/*` and `@capacitor-community/bluetooth-le` to `^7` in package.json).

```bash
npm install
npm run test:logic      # 18 tests, should all pass
npm run dev             # dev server: open in the Mac browser / phone Safari (no BLE there)
```

In the browser you can already: pick a destination, tap a node -> "I'm here", get routes,
turn on Debug -> "Tap map to teleport". BLE and the in-app QR scanner need the iOS app.

## 2. Build the iOS app

```bash
npm run build
npx cap add ios         # once
npm run cap:sync        # build + copy web assets into the iOS project
npm run cap:open        # opens Xcode
```

In `ios/App/App/Info.plist` add these keys (without them iOS blocks Bluetooth/camera/motion):

| Key | Value |
|---|---|
| `NSBluetoothAlwaysUsageDescription` | `Shortcut uses Bluetooth to find the nearest beacon and show where you are.` |
| `NSCameraUsageDescription` | `Shortcut scans QR codes to set your location.` |
| `NSMotionUsageDescription` | `Shortcut uses motion sensors to track your steps indoors.` |

In Xcode: select the **App** target -> *Signing & Capabilities* -> choose your Apple ID team and
a unique Bundle Identifier (match `appId` in `capacitor.config.ts`). Plug in the iPhone, enable
*Settings -> Privacy & Security -> Developer Mode*, pick the phone as run destination, press Run.
Free Apple ID builds expire after 7 days, which is fine for a hackathon.
**The Simulator has no Bluetooth; use a real iPhone.**

After changing web code: `npm run cap:sync`, then Run again in Xcode.

## 3. Flash the ESP32 beacons

1. Arduino IDE -> Boards Manager -> install **esp32 by Espressif Systems**.
2. Open `firmware/esp32_beacon/esp32_beacon.ino`.
3. Set `#define BEACON_ID "B1"`, upload. Repeat for the other boards with `"B2"`, `"B3"`.
4. Open Serial Monitor (115200) to confirm "advertising as CNAV-B1". Power them from USB power banks / chargers.

The ids must match `beacons` in `src/data/building.json`
(`{ "id": "B1", "node": "<nodeId where it is mounted>" }`). Moving a beacon = edit JSON, no reflash.

### Placing only 3 beacons
Beacons give *room-level* fixes (nearest beacon wins), not exact coordinates. With 3 boards:
- Put them where a wrong guess costs the most and where QR codes are awkward, e.g. main lobby,
  the stairwell/elevator landing, and the busiest hallway junction.
- Keep them >= 8-10 m apart, same height (~2 m, on a wall, not inside a metal box), same orientation.
- Everything else is covered by step counting + QR codes.
- Use **Debug** in the app to watch live RSSI per beacon (about -50 dBm = very close, -90 = barely audible).
  If it flips between beacons, raise `hysteresisDb` or lower `alpha` in `src/lib/beacon-math.ts`.

## 4. Map the real building (do this early!)
Edit `src/data/building.json`:
- `floors[]`: `width`/`height` in plan units; optional `image` (put the plan PNG in `public/plans/`, reference as `/plans/f1.png`).
- `nodes[]`: every door, intersection, stairs/elevator landing. `x,y` in plan units (y grows downward). Nodes with a `name` appear in the destination list.
- `edges[]`: walkable connections. Stairs/elevators connect nodes on different floors (`"type": "stairs" | "elevator"`).
- `metersPerUnit`: real meters per plan unit. Measure one corridor and divide.
- `northOffsetDeg`: degrees clockwise from true north to the plan's "up". A wrong value makes the dot walk the wrong way.

`npm run test:logic` validates that every edge and beacon references real nodes.

## 5. QR codes
```bash
npm run qr                              # payload "cnav:<nodeId>" -> scanned inside the app
npm run qr -- --url https://your.host   # payload is a URL -> also works with the iPhone Camera / Safari
```
Open `qr-codes/index.html`, print, tape each code at its location.

## How positioning works
`PositionEngine` holds the position. QR scan / BLE beacon / manual tap = **anchor** (exact node).
Steps (accelerometer peaks + compass heading) move the dot between anchors, snapped to the nearest corridor.
Foreground only: iOS pauses sensors when the app is backgrounded.

## Known limitations
- Routes start at the node nearest the dot (not the exact point), so the first leg may briefly point backwards.
- Compass is noisy near metal/elevators; snapping to corridors hides most drift, and any anchor resets it.
- BLE accuracy is nearest-beacon, not metre-level.
- The UI, BLE and motion adapters were written without being run on a device; expect to debug them first.
