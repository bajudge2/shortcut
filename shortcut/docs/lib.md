# Pure TypeScript library

Everything in `src/lib/` is platform-independent and tested by `npm run test:logic`.

## `graph.ts`
- `indexBuilding(building)` validates edge references and builds node/adjacency indexes.
- `findRoute(index, fromId, toId, options)` runs Dijkstra; `accessible` excludes stairs.
- `nearestNode(...)` and `snapToGraph(...)` locate nodes and project points onto corridors.
- `routeHeadingAt(...)` returns the compass heading of the nearest active-route segment, or null when farther than the configured meter limit.
- `describeRoute(...)`, `turnAngle(...)`, `nodeLabel(...)`, and `destinations(...)` support directions/UI.

## `pdr-math.ts`
- `advanceStep(...)` converts a compass heading and stride meters into plan movement, then corridor-snaps it.
- `StepObservation` carries fused heading, acceleration peak, and timestamp.
- `StepDetector` detects debounced acceleration peaks. `lastPeak` exposes signal strength; `reset()` starts a clean session.
- `HeadingFilter` is the older circular EMA retained for compatibility/tests.

## `fusion-math.ts`
- `normalizeHeading` and `headingDelta` handle circular degrees.
- `GyroCompassFusion` integrates short gyro intervals and applies slow compass correction, rejecting poor compass accuracy.
- `WrongWayDetector` requires sustained opposite steps before warning and sustained aligned steps before clearing.

## `beacon-math.ts`
- `averageRssiBatch` averages one-second RSSI samples after dropping extreme outliers when possible.
- `BeaconTracker` applies EMA, staleness/minimum-RSSI filtering, a dB switching margin, and consecutive-decision confirmation.
- `parseBeaconName` extracts the short id from `CNAV-<id>`.

- `BeaconFix` is the shared stable beacon observation (`id`, averaged RSSI dBm) consumed by the engine.
- `Building`, `GraphNode`, `GraphEdge`, `BeaconDef`, `Position`, and `Route` define shared data contracts.

Other modules define shared types and parse URL-only demo deep links.
