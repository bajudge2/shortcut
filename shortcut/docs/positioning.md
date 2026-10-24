# Positioning

## `PositionEngine` (`src/positioning/engine.ts`)
The single positional authority. It indexes the building, restores recent exact positions, and exposes position and navigation subscriptions.

Inputs:
- `setAnchor(nodeId, source)`: exact manual/BLE graph-node fix.
- `setPoint(floor, x, y)`: debug point snapped to a corridor.
- `onBeacon(fix)`: accepts the stable one-second BLE winner. New beacons anchor exactly; a very close current beacon can periodically correct PDR drift. Temporary null readings preserve beacon identity so reacquisition cannot bypass correction thresholds/cooldown.
- `onStep(observation)`: advances PDR using an accelerometer-confirmed step and compass+gyro heading.
- `setRoute(nodes)`: supplies route context for wrong-way detection; it is navigation configuration, not a position source.

`NavigationState` reports sustained wrong-way state and heading error. Three opposite steps trigger; two aligned steps clear. Manual and BLE anchors reset the warning.

## `BleLocator` (`src/positioning/ble.ts`)
Capacitor BLE adapter for real iPhones. It filters by service UUID/name, collects duplicate RSSI packets for one second, robustly averages each beacon, and sends one fresh sample per beacon to `BeaconTracker`. It emits a stable shared `BeaconFix` and debug snapshots once per second; stale samples cannot provide a new switch confirmation.

## `MotionSensors` (`src/positioning/motion.ts`)
WebView device adapter. `start()` must run directly from a user tap for iOS permission; motion and orientation permission requests are invoked together before awaiting. Acceleration magnitude drives `StepDetector`; rotation-rate yaw updates heading between compass readings; absolute orientation corrects gyro drift. It emits only confirmed `StepObservation`s to the engine and requests a screen wake lock when available.

The phone should be held roughly flat in portrait, top edge pointing along travel. iOS foreground sensor behavior and compass interference require an on-device walk test.
