# Requirements Document

## Introduction

This feature covers HACKATHON_PLAN Task 3 for Shortcut, the indoor navigation app for UMass Lowell Building A. It polishes the user-facing states that appear in the 3-minute judge video: a clearer "you are here" state, a prominent arrival state, and a new "Bluetooth signal lost, relocate" prompt shown when beacons go quiet while Bluetooth scanning is on. Manual "I'm here" stays available at all times as the recovery path.

Bluetooth scanning and step counting only run in the native iOS build on the teammate's Mac. The signal-lost behavior must therefore be verifiable in a desktop or iPhone Safari browser through pure, unit-tested timing logic plus a Debug-panel simulation.

Scope constraints carried from the project rules:
- UI code lives only in `src/App.tsx`, `src/components/*`, and `src/styles.css`. New UI goes into new components to keep `App.tsx` changes small, because a teammate is editing that file in parallel.
- Position changes go through the Position_Engine. Components never compute or set positions directly.
- New timing and state logic for signal-lost detection lives in `src/lib/*`, stays pure, and is covered by `npm run test:logic`.
- No new runtime or dev dependencies.
- The QR scanner was removed and is out of scope.

## Glossary

- **Shortcut_App**: The React + TypeScript web app in `shortcut/src`, running in a browser or in the Capacitor iOS shell.
- **Position_Engine**: The `PositionEngine` class in `src/positioning/engine.ts`. Single source of truth for the user's position.
- **Position**: The current user location held by the Position_Engine (floor, x, y, optional nodeId, source, timestamp).
- **Position_Source**: One of `manual`, `ble`, `pdr` (step counting), or `sim` (Debug teleport).
- **Anchor**: A Position set exactly on a graph node by a manual "I'm here" tap or a Bluetooth beacon fix.
- **Manual_Anchor**: An Anchor created when the user chooses "I'm here" on a node.
- **Beacon_Report**: One call of `onBeacon(beaconId | null)`, emitted about once per second while Bluetooth scanning is on. `null` means no usable beacon is in range.
- **Quiet_Period**: The continuous time during which every Beacon_Report has been `null` while Bluetooth scanning is on.
- **Quiet_Threshold**: The Quiet_Period length after which the signal is considered lost. Default 15 seconds, defined as a single named constant in `src/config.ts`.
- **Suppression**: The Signal_Monitor state entered after a Manual_Anchor or a Relocate_Banner dismissal, during which the signal-lost flag stays false until a non-null Beacon_Report is received.
- **Signal_Monitor**: The new pure logic module in `src/lib/` that turns Beacon_Reports, Bluetooth on/off changes, Manual_Anchors, and dismissals plus timestamps into a signal-lost flag.
- **Relocate_Banner**: The new UI component that tells the user the beacon signal was lost and how to set the location manually.
- **Position_Status**: The new UI component that describes the current Position in text ("You are near ...").
- **Arrival_Card**: The new UI component shown when the user has reached the selected destination.
- **Map_View**: The existing Leaflet map component in `src/components/MapView.tsx`.
- **Debug_Panel**: The existing Debug section of the bottom panel in `App.tsx`.
- **Signal_Simulation**: A Debug_Panel control that feeds simulated Beacon_Reports to the Signal_Monitor and Position_Engine so the Bluetooth flows run in a browser.
- **Node_Sheet**: The existing bottom sheet opened by tapping a map node, with "Navigate here" and "I'm here" actions.
- **Viewed_Floor**: The floor currently displayed by the Map_View.

## Requirements

### Requirement 1: Signal-lost detection logic

**User Story:** As a developer, I want signal-lost detection as pure, tested logic, so that I can trust the relocate prompt without a phone, Bluetooth, or beacons.

#### Acceptance Criteria

1. THE Signal_Monitor SHALL compute the signal-lost flag only from the inputs passed to it (Bluetooth on/off changes, Beacon_Reports, Manual_Anchors, dismissals, and a query timestamp), each carrying a caller-supplied timestamp in integer milliseconds. It SHALL NOT read timers, the system clock, Bluetooth, or the DOM.
2. THE Signal_Monitor SHALL accept the Quiet_Threshold in milliseconds as a construction parameter, and SHALL default to the Quiet_Threshold constant in `src/config.ts` (15,000 ms) when no value is supplied.
3. WHILE Bluetooth scanning is off, THE Signal_Monitor SHALL report the signal-lost flag as false for every query timestamp.
4. WHILE Bluetooth scanning is off, WHEN a Beacon_Report, Manual_Anchor, or dismissal is received, THE Signal_Monitor SHALL ignore it and leave its state unchanged.
5. WHEN Bluetooth scanning is turned on while scanning is off, THE Signal_Monitor SHALL start a new Quiet_Period at the turn-on timestamp. WHEN a turn-on input is received while scanning is already on, THE Signal_Monitor SHALL leave the current Quiet_Period unchanged.
6. WHILE Bluetooth scanning is on, WHEN a Beacon_Report with a non-null beacon id is received, THE Signal_Monitor SHALL set the signal-lost flag to false, end the current Quiet_Period, and clear any suppression set by a Manual_Anchor or dismissal.
7. WHILE Bluetooth scanning is on and no Quiet_Period is in progress, WHEN a `null` Beacon_Report is received, THE Signal_Monitor SHALL start a new Quiet_Period at that report's timestamp. Further `null` Beacon_Reports SHALL NOT move the start of a Quiet_Period that is already in progress.
8. WHILE Bluetooth scanning is on and no suppression is active, WHEN the signal-lost flag is queried at a timestamp at least the Quiet_Threshold after the current Quiet_Period's start, THE Signal_Monitor SHALL report the signal-lost flag as true. A query 1 ms before the Quiet_Threshold elapses SHALL report false.
9. WHILE Bluetooth scanning is on, WHEN a Manual_Anchor is set, THE Signal_Monitor SHALL set the signal-lost flag to false and activate suppression. The flag SHALL stay false, regardless of how many `null` Beacon_Reports follow, until a non-null Beacon_Report is received and a new Quiet_Period then reaches the Quiet_Threshold.
10. WHILE Bluetooth scanning is on, WHEN the user dismisses the Relocate_Banner, THE Signal_Monitor SHALL set the signal-lost flag to false and activate suppression. The flag SHALL stay false, regardless of how many `null` Beacon_Reports follow, until a non-null Beacon_Report is received and a new Quiet_Period then reaches the Quiet_Threshold.
11. WHEN Bluetooth scanning is turned off, THE Signal_Monitor SHALL set the signal-lost flag to false, discard the current Quiet_Period, and clear any suppression.
12. IF an input or query arrives with a timestamp earlier than the latest timestamp the Signal_Monitor has already accepted, THEN THE Signal_Monitor SHALL ignore it, leave its state unchanged, and report the flag as it was at the latest accepted timestamp.
13. FOR ALL sequences of inputs containing a non-null Beacon_Report at time t, THE Signal_Monitor SHALL report the signal-lost flag as false at every query timestamp from t (inclusive) to t plus the Quiet_Threshold (exclusive). This is an invariant.
14. FOR ALL sequences of inputs, querying the Signal_Monitor twice at the same timestamp with no new input in between SHALL return the same signal-lost flag (idempotence).
15. THE `npm run test:logic` suite SHALL run under plain Node with no added dependencies and SHALL include at least one test for each of criteria 2 through 14. The command SHALL exit with code 0, with every existing test also passing.

### Requirement 2: Relocate prompt

**User Story:** As a user walking the building, I want a clear prompt when the beacon signal is lost, so that I know to set my location by hand instead of trusting a stale dot.

#### Acceptance Criteria

1. WHEN the signal-lost flag changes from false to true, THE Shortcut_App SHALL display the Relocate_Banner within 1 second, positioned inside the Map_View and anchored to the Map_View's top edge.
2. WHILE the signal-lost flag is true, THE Shortcut_App SHALL keep the Relocate_Banner displayed regardless of the Viewed_Floor, whether a route is active, and whether the Debug_Panel is open.
3. THE Relocate_Banner SHALL display the text "Bluetooth signal lost" and an instruction telling the user to tap their location on the map and choose "I'm here", with all text fully visible without scrolling or truncation on a viewport 320 px wide or wider.
4. WHILE the Relocate_Banner is displayed, THE Map_View SHALL open the Node_Sheet when the user taps a node outside the Relocate_Banner's bounds, and THE Map_View SHALL accept pan and zoom gestures outside the Relocate_Banner's bounds.
5. WHEN the user chooses "I'm here" in the Node_Sheet while the Relocate_Banner is displayed, THE Shortcut_App SHALL set a Manual_Anchor through the Position_Engine, notify the Signal_Monitor of the Manual_Anchor, and hide the Relocate_Banner within 200 ms.
6. THE Relocate_Banner SHALL provide a dismiss button with the accessible name "Dismiss" and a touch target of at least 44 by 44 CSS px.
7. WHEN the user activates the dismiss button, THE Shortcut_App SHALL notify the Signal_Monitor of the dismissal, hide the Relocate_Banner within 200 ms, and leave the current Position unchanged.
8. WHEN the signal-lost flag changes from true to false for any reason, including a non-null Beacon_Report or Bluetooth scanning being turned off, THE Shortcut_App SHALL hide the Relocate_Banner within 1 second.
9. IF the Relocate_Banner has been hidden by a dismissal or a Manual_Anchor, THEN THE Shortcut_App SHALL display the Relocate_Banner again only after the Signal_Monitor sets the signal-lost flag to true again, as defined in Requirement 1 criteria 9 and 10.
10. WHEN the Relocate_Banner appears, THE Relocate_Banner SHALL announce the banner text to screen readers exactly once per appearance through a polite live region, and SHALL NOT move keyboard or screen-reader focus.
11. WHILE both a toast and the Relocate_Banner are displayed, THE Shortcut_App SHALL display both with no overlap between their bounding boxes.
12. WHILE the Relocate_Banner is displayed and a Position is known, THE Map_View SHALL keep showing the Position marker at the last known Position and floor, unchanged until the Position_Engine reports a new Position.

### Requirement 3: Manual "I'm here" fallback

**User Story:** As a presenter filming the demo, I want manual "I'm here" to work at any moment, so that a misbehaving beacon never stalls a take.

#### Acceptance Criteria

1. THE Node_Sheet SHALL show an enabled "I'm here" action for every node on every floor, in every combination of these states: Bluetooth scanning on or off, Signal_Simulation on or off, Relocate_Banner displayed or hidden, Arrival_Card displayed or hidden, route active or inactive, and Position known or unknown.
2. WHEN the user chooses "I'm here" on a node, THE Position_Engine SHALL set the Position to that node's floor, x, y, and nodeId with Position_Source `manual`, replacing any prior Position regardless of its Position_Source.
3. WHEN the Position_Engine sets a Manual_Anchor, THE Map_View SHALL show the position marker at the anchored node within 200 ms and THE Node_Sheet SHALL close.
4. WHEN a Manual_Anchor is set on a node whose floor differs from the Viewed_Floor, THE Map_View SHALL switch the Viewed_Floor to the anchored node's floor within 200 ms.
5. WHEN a Manual_Anchor is set while a destination is selected, THE Shortcut_App SHALL recompute the route with the anchored node as the start and display the updated route and turn-by-turn list within 200 ms.
6. IF no route exists from the anchored node to the selected destination, THEN THE Shortcut_App SHALL display a message indicating that no route was found, keep the Manual_Anchor Position, keep the destination selected, and show no stale route line.
7. WHILE no Position is known, THE Shortcut_App SHALL display a hint telling the user to tap a place on the map and choose "I'm here", and THE Shortcut_App SHALL hide that hint within 200 ms after a Position becomes known.

### Requirement 4: Signal-loss simulation in the browser

**User Story:** As the developer on Windows, I want to simulate beacon reports in Safari, so that I can verify the relocate flow and the beacon snap without the iOS build.

#### Acceptance Criteria

1. WHILE the Debug_Panel is open, THE Debug_Panel SHALL show a Signal_Simulation toggle labelled "Simulate Bluetooth" that is in the off state each time the Shortcut_App loads.
2. WHEN Signal_Simulation is turned on, THE Shortcut_App SHALL inform the Signal_Monitor that Bluetooth scanning is on, using the turn-on timestamp, so that a new Quiet_Period starts at that timestamp.
3. WHILE Signal_Simulation is on, THE Shortcut_App SHALL deliver a `null` Beacon_Report to the Signal_Monitor every 1000 ms (tolerance ±200 ms), whether or not the Debug_Panel is open.
4. WHILE Signal_Simulation is on, THE Debug_Panel SHALL show exactly one button per beacon listed in `building.json` (B1, B2, B3), each labelled with its beacon id.
5. WHEN the user activates a simulated beacon button, THE Shortcut_App SHALL deliver one non-null Beacon_Report for that beacon id to both the Signal_Monitor and the Position_Engine, and THE Map_View SHALL show the position marker at the node mapped to that beacon in `building.json`, with Position_Source `ble`, within 200 ms.
6. WHILE Signal_Simulation is on, THE Debug_Panel SHALL show the current Quiet_Period length in whole seconds (rounded down, shown as 0 when no Quiet_Period is active) and the current signal-lost flag as "Yes" or "No", refreshing both values at least once every 1000 ms.
7. WHEN Signal_Simulation is turned off, THE Shortcut_App SHALL deliver no further simulated Beacon_Reports after the turn-off moment, SHALL inform the Signal_Monitor that Bluetooth scanning is off, and SHALL keep the current Position unchanged.
8. WHILE real Bluetooth scanning is on, THE Debug_Panel SHALL show the Signal_Simulation toggle as disabled and SHALL ignore activation of the toggle.
9. IF real Bluetooth scanning is turned on while Signal_Simulation is on, THEN THE Shortcut_App SHALL turn Signal_Simulation off, stop delivering simulated Beacon_Reports, and keep only real Beacon_Reports flowing to the Signal_Monitor.
10. THE Signal_Simulation SHALL deliver beacon reports through the same Position_Engine `onBeacon` method used by real Bluetooth scanning.

### Requirement 5: "You are here" status

**User Story:** As a user, I want to see clearly where the app thinks I am and why, so that I can judge whether to trust the dot or correct it.

#### Acceptance Criteria

1. WHILE a Position is known, THE Position_Status SHALL display "You are near" followed by the name of the named node on the Position's floor with the smallest straight-line distance in plan units from the Position's x and y. A named node is a node with a non-empty name in `building.json`. If two or more named nodes are equally close, the node listed first in `building.json` is used.
2. IF no named node exists on the Position's floor and at least one node exists on that floor, THEN THE Position_Status SHALL display "You are near" followed by the label of the nearest node on that floor, using the same distance and tie-break rule as criterion 1 and the label produced by the existing `nodeLabel` helper in `src/lib/graph.ts`.
3. WHILE a Position is known, THE Position_Status SHALL display the Position_Source label matching the Position's current source: "Bluetooth" for `ble`, "I'm here" for `manual`, "Steps" for `pdr`, and "Teleport" for `sim`.
4. WHILE a Position is known and the Position's floor differs from the Viewed_Floor, THE Position_Status SHALL display a button labelled with the Position's floor `label` from `building.json` (for example "Floor 1"). Activating the button SHALL set the Viewed_Floor to the Position's floor, and the button SHALL be hidden once the Viewed_Floor equals the Position's floor.
5. WHEN a new Anchor is set (Position_Source `manual` or `ble`), THE Map_View SHALL start a pulse animation on the position marker within 200 ms, and the animation SHALL end within 1.5 seconds of starting. Position updates with Position_Source `pdr` or `sim` SHALL NOT start the pulse animation.
6. WHERE the operating system reports a reduced-motion preference (`prefers-reduced-motion: reduce`), THE Map_View SHALL display the position marker without the pulse animation, while still moving the marker to the new Anchor.
7. THE Map_View SHALL draw the position marker above route lines, node markers, and the destination ring, so that where they overlap, the position marker is visible on top and receives no occlusion from those layers.
8. WHILE a Position is known, THE Position_Status SHALL expose the "You are near" text and Position_Source label to screen readers through a polite live region. The live region text SHALL change only when the nearest node used by criterion 1 or 2 or the Position_Source changes, and SHALL stay unchanged for Position updates that change neither.
9. WHEN the Position changes, THE Position_Status SHALL update the displayed nearest-node name and Position_Source label to match the new Position within 200 ms.
10. IF no Position is known, or no node exists on the Position's floor, THEN THE Position_Status SHALL display no "You are near" text and no Position_Source label.
11. THE Shortcut_App SHALL find the nearest node for the Position_Status with a pure function in `src/lib/` that takes the building data, a floor, and x and y coordinates. The `npm run test:logic` suite SHALL include tests for that function covering criterion 1 (nearest named node, tie-break by `building.json` order), criterion 2 (fallback to the nearest unnamed node's label), and criterion 10 (a floor with no nodes returns no result).

### Requirement 6: Arrival state

**User Story:** As a user, I want an unmistakable arrival moment, so that I know I reached my destination and the video has a clear payoff shot.

#### Acceptance Criteria

1. WHEN the route start node becomes equal to the selected destination node, whether through a Position change from any Position_Source or through the user selecting the destination the route already starts at, THE Shortcut_App SHALL display the Arrival_Card in place of the turn-by-turn list within 200 ms.
2. THE Arrival_Card SHALL display the text "You've arrived" and the destination name, each rendered at a font size of at least 22 px.
3. WHEN the Arrival_Card appears, THE Arrival_Card SHALL play an entrance animation lasting at most 1 second, and SHALL NOT replay the animation while the Arrival_Card stays displayed.
4. WHERE the operating system reports a reduced-motion preference, THE Arrival_Card SHALL appear in its final state with no entrance animation.
5. WHEN the Arrival_Card appears, THE Arrival_Card SHALL announce "You've arrived" and the destination name to screen readers exactly once through a polite live region, and SHALL NOT announce again until the Arrival_Card is hidden and shown again.
6. WHEN the user activates the "Done" button on the Arrival_Card, THE Shortcut_App SHALL clear the selected destination, hide the Arrival_Card and the destination ring, and keep the current Position unchanged.
7. WHILE the Arrival_Card is displayed, THE Map_View SHALL draw the destination ring in the same arrival color used by the Arrival_Card, and SHALL return the ring to its normal color when the Arrival_Card is hidden while a destination is still selected.
8. IF the route start node differs from the selected destination node continuously for at least 3 seconds while the Arrival_Card is displayed, THEN THE Shortcut_App SHALL hide the Arrival_Card and show the turn-by-turn list for the current route.
9. WHILE the Arrival_Card is displayed, IF the route start node differs from the destination node for less than 3 seconds and then equals the destination node again, THEN THE Shortcut_App SHALL keep the Arrival_Card displayed with no hide, re-entrance animation, or repeated announcement.
10. WHEN a new Anchor is set on a node other than the destination node, or the user selects a different destination, while the Arrival_Card is displayed, THE Shortcut_App SHALL hide the Arrival_Card within 200 ms and show the turn-by-turn list for the resulting route.

### Requirement 7: Destination and guidance hints

**User Story:** As a first-time user, I want the panel to tell me the next thing to do, so that the demo reads clearly without narration.

#### Acceptance Criteria

1. WHILE a destination is selected and no Position is known, THE Shortcut_App SHALL display the destination name and a hint to tap the user's location on the map and choose "I'm here", in place of the no-Position hint defined in Requirement 3 criterion 7.
2. WHILE a Position is known and no destination is selected, THE Shortcut_App SHALL display a hint to choose a destination from the picker or tap a room and choose "Navigate here".
3. WHILE a route is active and the Arrival_Card is not displayed, THE Shortcut_App SHALL display the destination name, identical to the name shown for that node in the destination picker, above the distance and time summary.
4. THE destination picker SHALL list only nodes with a non-empty `name` in `building.json`, grouped by floor in the order the floors appear in `building.json`, with destinations in each floor group sorted A to Z by name ignoring letter case, and ties broken by node id.
5. IF a floor has no nodes with a non-empty `name`, THEN THE destination picker SHALL omit the group for that floor.
6. IF a destination is selected and a Position is known but no route exists between them, THEN THE Shortcut_App SHALL display the destination name and a message indicating that no route was found, and SHALL keep the destination selected.
7. WHEN the Position, the selected destination, or the route changes, THE Shortcut_App SHALL update the panel within 200 ms so that at most one guidance hint from criteria 1, 2, and Requirement 3 criterion 7 is displayed at a time.

### Requirement 8: Code organization and safety

**User Story:** As a team member editing `App.tsx` in parallel, I want this work isolated in new files, so that merges stay small and the tested core stays intact.

#### Acceptance Criteria

1. THE Shortcut_App SHALL implement the Relocate_Banner, Position_Status, and Arrival_Card each as a separate new file in `src/components/`, and SHALL place all new UI code for this feature only in `src/App.tsx`, `src/components/*`, and `src/styles.css`.
2. THE Shortcut_App SHALL implement the Signal_Monitor in a new file in `src/lib/` whose imports are limited to other `src/lib/` modules and `src/config.ts`, with no imports from React, Capacitor, or Leaflet and no references to `window`, `document`, `navigator`, `setTimeout`, `setInterval`, or `Date.now`.
3. THE Shortcut_App SHALL change Position only by calling Position_Engine methods, and the Relocate_Banner, Position_Status, Arrival_Card, and Signal_Simulation code SHALL contain no code that computes Position coordinates or assigns Position fields directly.
4. THE Shortcut_App SHALL add no entries to, remove no entries from, and change no version strings in `dependencies` or `devDependencies` in `package.json`.
5. WHEN the feature is complete, THE `npm run typecheck`, `npm run test:logic`, and `npm run build` commands SHALL each exit with code 0, with no existing test deleted, skipped, or modified to change what it asserts.
6. THE Shortcut_App SHALL define the Quiet_Threshold as exactly one named constant in `src/config.ts`, and THE Signal_Monitor, Signal_Simulation, and Debug_Panel SHALL reference that constant instead of a literal 15-second value.
7. THE Shortcut_App SHALL limit changes to `src/App.tsx` to imports, rendering the new components, passing props, and connecting the Signal_Monitor and Signal_Simulation to existing state, with no new component definitions inside `src/App.tsx`.
