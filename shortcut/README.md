# Shortcut

Indoor navigation for one campus building. An iOS app (React + Vite + TypeScript, wrapped with
Capacitor) that routes people to rooms, positioned by **ESP32 BLE beacons**, manual "I'm here" taps,
and **step counting** between them.

```
src/data/building.json   map data (floors, nodes, edges, beacons)  <- edit this for the real building
src/lib/                 routing (Dijkstra), directions, beacon smoothing, dead-reckoning math (pure, tested)
src/positioning/         engine (single source of truth) + BLE + motion-sensor adapters
src/components/          MapView (Leaflet, no tiles)
firmware/esp32_beacon/   PlatformIO C++ firmware for the beacons (ESP32, ESP32-S3, ESP32-WROVER-E)
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
turn on Debug -> "Tap map to teleport". BLE needs the iOS app.
To pre-stage a demo scene, open the app with `?at=<nodeId>&to=<nodeId>` (start position + destination).

## 2. Build the iOS app

```bash
npm run build
npx cap add ios         # once
npm run cap:sync        # build + copy web assets into the iOS project
npm run cap:open        # opens Xcode
```

In `ios/App/App/Info.plist` add these keys (without them iOS blocks Bluetooth/motion):

| Key | Value |
|---|---|
| `NSBluetoothAlwaysUsageDescription` | `Shortcut uses Bluetooth to find the nearest beacon and show where you are.` |
| `NSMotionUsageDescription` | `Shortcut uses motion sensors to track your steps indoors.` |

In Xcode: select the **App** target -> *Signing & Capabilities* -> choose your Apple ID team and
a unique Bundle Identifier (match `appId` in `capacitor.config.ts`). Plug in the iPhone, enable
*Settings -> Privacy & Security -> Developer Mode*, pick the phone as run destination, press Run.
Free Apple ID builds expire after 7 days, which is fine for a hackathon.
**The Simulator has no Bluetooth; use a real iPhone.**

After changing web code: `npm run cap:sync`, then Run again in Xcode.

## 3. Flash the ESP32 beacons

Needs [PlatformIO Core](https://docs.platformio.org/en/latest/core/installation/) (`pio`) or the
PlatformIO VS Code extension. Every board uses the **same source and protocol**, but each chip family gets its own binary; pick the env for the chip:

```bash
cd firmware/esp32_beacon
pio run -e esp32s3 -t upload -t monitor         # ESP32-S3 DevKitC (default env)
pio run -e esp32 -t upload -t monitor           # classic ESP32 (WROOM)
pio run -e esp32-wrover-e -t upload -t monitor  # ESP32-WROVER-E
```

A fresh board advertises as `CNAV-U<last 4 MAC hex>` with default calibration. The app ignores ids
that aren't in `building.json`, so it's harmless until named. Name and calibrate it from the iOS
app over BLE, or by typing JSON into the serial monitor (115200, one object per line, `help` lists commands):

```
{"id":"B1"}
{"txPower":3,"advInterval":40,"measuredPower":-61,"pathLoss":2.2}
{"cmd":"get"}
```

Settings are saved to flash (NVS) and survive reboots and reflashes; `{"cmd":"factory_reset"}` clears them.
The ids must match `beacons` in `src/data/building.json`
(`{ "id": "B1", "node": "<nodeId where it is mounted>" }`). Moving a beacon = edit JSON, no reflash.
The S3 environment enables USB CDC for its native USB Serial/JTAG port. Classic ESP32 and WROVER-E boards use UART0 through their USB-to-serial bridge (a bare module needs a 3.3 V UART adapter and boot/reset wiring).

### Calibration protocol (for the iOS app)
UUIDs are in `src/config.ts` and `firmware/esp32_beacon/src/protocol.h`.

- Beacons are connectable and keep advertising while a phone is connected.
- GATT service `BEACON_SERVICE_UUID` (same UUID that's advertised):
  - `BEACON_CONFIG_CHAR_UUID` (read/write). Read returns the current config as UTF-8 JSON:
    `{"v":1,"fw":"1.0.0","chip":"ESP32-S3","mac":"..","id":"B1","name":"CNAV-B1","txPower":3,"advInterval":40,"measuredPower":-59,"pathLoss":2,"rev":3,"locked":false}`.
    Write a UTF-8 JSON request (write *with* response) to change it. Keep each BLE write to one
    small request (under ~180 bytes, i.e. within the negotiated MTU); the 512-byte limit applies to serial.
  - `BEACON_STATUS_CHAR_UUID` (read/notify): result of the last request,
    `{"ok":true,"cmd":"set","rev":4,"changed":true}` or `{"ok":false,"cmd":"set","rev":3,"err":"..","field":"txPower"}`.
    Subscribe before writing, then re-read the config characteristic.
- Requests (any subset of fields; all are validated before anything is applied):

  | Field | Type / range | Meaning |
  |---|---|---|
  | `id` | 1-8 chars `A-Z a-z 0-9 _ -` | beacon id, advertised as `CNAV-<id>` |
  | `txPower` | int dBm, -30..25 | snapped to the chip's nearest level (ESP32: -12..9, S3: -24..20, steps of 3) |
  | `advInterval` | int ms, 20..10240 | advertising interval |
  | `measuredPower` | int dBm, -120..0 | calibrated RSSI at 1 m (stand 1 m away, average RSSI, send it) |
  | `pathLoss` | number, 1.0..6.0 | path-loss exponent for distance estimates (0.1 resolution) |
  | `pin` | string, 0-16 chars | optional PIN; once set, BLE writes need `"auth":"<pin>"`. `""` clears it |
  | `cmd` | `get` / `set` / `reboot` / `factory_reset` | defaults to `set` when fields are present |

- Every phone can read the calibration without connecting: the scan response carries manufacturer
  data for company id `0xFFFF` = `[version, measuredPower (int8), pathLoss*10 (uint8), rev & 0xFF]`.
  The primary packet also carries the TX power level.
- Security: without a PIN anyone in BLE range can rename/recalibrate a beacon. The PIN is a
  basic guard (sent in plaintext, 5 wrong tries = 30 s lockout). Serial always works (physical access),
  so a forgotten PIN is fixed with `{"cmd":"factory_reset"}` over USB.

### Placing only 3 beacons
Beacons give *room-level* fixes (nearest beacon wins), not exact coordinates. With 3 boards:
- Put them where a wrong guess costs the most, e.g. main lobby,
  the stairwell/elevator landing, and the busiest hallway junction.
- Keep them >= 8-10 m apart, same height (~2 m, on a wall, not inside a metal box), same orientation.
- Everything else is covered by step counting + manual "I'm here" taps.
- Use **Debug** in the app to watch live RSSI per beacon (about -50 dBm = very close, -90 = barely audible).
  If it flips between beacons, raise `hysteresisDb` or lower `alpha` in `src/lib/beacon-math.ts`.
  A beacon only moves the dot once it's louder than `minRssi` (default -78 dBm, roughly 5 m). Stand where you
  want the snap to happen, read the RSSI in Debug, and set `minRssi` a few dB below it.

## 4. Map the real building (do this early!)
Edit `src/data/building.json`:
- `floors[]`: `width`/`height` in plan units; optional `image` (put the plan PNG in `public/plans/`, reference as `/plans/f1.png`).
- `nodes[]`: every door, intersection, stairs/elevator landing. `x,y` in plan units (y grows downward). Nodes with a `name` appear in the destination list.
- `edges[]`: walkable connections. Stairs/elevators connect nodes on different floors (`"type": "stairs" | "elevator"`).
- `metersPerUnit`: real meters per plan unit. Measure one corridor and divide.
- `northOffsetDeg`: compass heading of the plan's "up" direction. A wrong value makes the dot walk the wrong way.
  The iPhone compass reports *magnetic* north (about 14° off true north in Lowell), so measure it in the
  building: turn on Steps + Debug, stand in a corridor that runs straight up the plan, point the top of the
  phone down the corridor, and use the Heading shown in Debug.

`npm run test:logic` validates that every edge and beacon references real nodes, that every node is on its
plan and connected, and that every destination is reachable.

## How positioning works
`PositionEngine` holds the position. BLE beacon / manual tap = **anchor** (exact node).
Steps (accelerometer peaks + compass heading) move the dot between anchors, snapped to the nearest corridor.
Foreground only: iOS pauses sensors when the app is backgrounded.

## Known limitations
- Routes start at the node nearest the dot (not the exact point), so the first leg may briefly point backwards.
- Compass is noisy near metal/elevators; snapping to corridors hides most drift, and any anchor resets it.
- BLE accuracy is nearest-beacon, not metre-level.
- The UI, BLE and motion adapters were written without being run on a device; expect to debug them first.
