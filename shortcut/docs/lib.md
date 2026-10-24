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
- `BeaconTracker` applies EMA, staleness/minimum-RSSI filtering, a dB switching margin, and consecutive-decision confirmation. Only the first fix after construction/`reset()` is immediate. The current beacon is remembered through silence, so if it drops out of range another beacon still needs `switchConfirmations` fresh batches; until then `best()` returns null.
- `parseBeaconName` extracts the short id from `CNAV-<id>`.

## `focus-layers.ts`
- `focusLayers(building, floorId, position, routeNodes, destinationId)` → `{ segments, start, destination }` in plan units. `segments` are the Route's consecutive on-floor runs (an off-floor or unknown id ends a run; runs < 2 points dropped). `start` exists only when `routeNodes[0]` is on the floor; `destination` only when the destination is a known node on the floor, labelled with `destinationName`. Output ignores `position`. Pure; returns fresh objects.
- `routeKey(routeNodes)` joins ids with `"\u0000"` (`""` when empty); used as a React effect dependency.

## `follow-view.ts`
- `followView(building, floorId, position, routeNodes)` → `{ rect, center, nodeIds }` or null (empty Route, no/other-floor position, unknown floor, bad `metersPerUnit`). The rectangle is centered on the clamped position, sized to include the leading run of up to `FOLLOW_LOOKAHEAD_NODES` (5) Route nodes within 20 m per axis, between `FOLLOW_MIN_EXTENT_M` (20 m) and `FOLLOW_MAX_EXTENT_M` (40 m) per side, then shifted inside the plan (or the whole axis when the plan is smaller). `nodeIds` are those upcoming nodes.

## `follow-state.ts`
- `FollowMode` `'following' | 'paused'`, `INITIAL_FOLLOW_MODE = 'following'`.
- `stepFollow(mode, event)`: `userMove` → `paused`; `recenter`, `destChange`, `floorChange`, `newAnchor` → `following`.
- `showRecenter(mode, follow)`: paused and a follow view exists.
- `viewCommand(mode, follow, floorChanged, newAnchor)` → exactly one of `follow` (with rect), `plan`, `reveal`, `none`, in that priority.

## `guidance.ts`, `signal-monitor.ts`, `arrival.ts`, `anchor.ts`
- `guidance.ts`: nearest landmark, source labels, destination names/groups, the single `guidanceFor` hint selector, and `locationPickerValue(groups, position)` (the position's `nodeId` when it is a listed named place, else `""`).
- `signal-monitor.ts`: pure timing for the “Bluetooth signal lost” state (`SIGNAL_QUIET_THRESHOLD_MS`).
- `arrival.ts`: arrival detection with a dwell (`ARRIVAL_DWELL_MS`) so brief drift doesn't hide the arrival card.
- `anchor.ts`: `newAnchorNodeId(prev, next)` returns the node id when a manual/BLE position is a new anchor; PDR and teleport never count.

## Types and deep links
- `BeaconFix` is the shared stable beacon observation (`id`, averaged RSSI dBm) consumed by the engine.
- `Building`, `GraphNode`, `GraphEdge`, `BeaconDef`, `Position`, and `Route` define shared data contracts.

Other modules define shared types and parse URL-only demo deep links.
