# Requirements Document

## Introduction

This feature declutters the Shortcut map. Today the Map_View draws every corridor edge, every node dot, and a permanent name label for every named place, which hides the floor plan and makes the screen hard to read in the demo video. After this change the map shows the first-floor floor plan image as the base layer, and on top of it only three things: where the user is, where the user is going, and the suggested route between them.

While a route is active, the map zooms in and follows the user's dot as they walk, keeping the next part of the route in view. If the user pans or zooms by hand, following pauses and a "Recenter" button brings it back. With no active route, the map fits the whole floor plan, as before.

Because node dots are no longer drawn, the user can no longer tap a node to open the Node_Sheet and choose "I'm here" or "Navigate here". Setting a location without Bluetooth moves to a new "I'm at" dropdown in the header, next to the existing "Where to?" destination picker. The Node_Sheet is removed. The Debug "Tap map to teleport" control stays as a debug-only feature.

This feature changes behavior defined in the `demo-ux-polish` spec. The relocate banner, Position_Status, Arrival_Card, pulsing position marker, destination arrival ring, and Debug "Simulate Bluetooth" keep working. Requirements in `demo-ux-polish` that refer to tapping the map and choosing "I'm here" (its Requirement 2 criteria 3, 4, 5; Requirement 3 criteria 1, 3, 7; Requirement 7 criteria 1, 2) are superseded by Requirements 4 and 5 of this document. The `demo-ux-polish` documents are left unchanged.

Scope constraints carried from the project rules:
- UI code lives only in `src/App.tsx`, `src/components/*`, and `src/styles.css`. New UI goes into new components to keep `App.tsx` changes small.
- Position changes go through the Position_Engine. Components never compute or set positions directly.
- New pure logic for deciding what the map shows and how it frames the view lives in `src/lib/*` and is covered by `npm run test:logic` (`node --test`, `tests/*.test.ts`, with the `tests/prng.ts` helper available).
- No new runtime or dev dependencies.

Out of scope (future work):
- Rotating the map by compass heading. The map stays plan-up (the top of the floor plan image at the top of the screen) in every state.
- Re-confirming the current place from the Location_Picker. When the Position is already on a Named_Place (for example set by Bluetooth), picking that same option again does nothing, because a `<select>` reports no change. The Relocate_Banner's Dismiss button still hides the banner in that case.

## Glossary

- **Shortcut_App**: The React + TypeScript web app in `shortcut/src`, running in a browser or in the Capacitor iOS shell.
- **Position_Engine**: The `PositionEngine` class in `src/positioning/engine.ts`. Single source of truth for the user's position.
- **Position**: The current user location held by the Position_Engine (floor, x, y, optional nodeId, source, timestamp).
- **Manual_Anchor**: A Position set exactly on a graph node with Position_Source `manual`, created by `engine.setAnchor(id, 'manual')`.
- **New_Anchor**: A Position change for which the existing `newAnchorNodeId(previous, next)` in `src/lib/anchor.ts` returns a node id, meaning a new Manual_Anchor or Bluetooth anchor was just set.
- **Signal_Monitor**: The existing signal-lost logic from `demo-ux-polish`, reached in `App.tsx` through `useSignalMonitor`; its `notifyManualAnchor()` call activates suppression after a Manual_Anchor.
- **Map_View**: The existing Leaflet map component in `src/components/MapView.tsx`, using `L.CRS.Simple` with plan coordinates (x right, y down).
- **Viewed_Floor**: The floor currently displayed by the Map_View.
- **Floor_Plan**: The image referenced by a floor's `image` field in `building.json` (for floor `f1`, `/plans/f1.png`), stretched over the floor's `width` by `height` plan-unit rectangle. Node coordinates are in the same pixel space as the image.
- **Plan_Outline**: The fallback base layer for a floor with no usable Floor_Plan: a light-filled rectangle with a 1 px border covering the floor's `width` by `height` plan units.
- **Plan_Bounds**: The rectangle from (0, 0) to (floor `width`, floor `height`) in plan units.
- **Plan_Units_Per_Metre**: `1 / building.metersPerUnit`, used to convert a distance in metres to plan units.
- **Named_Place**: A node whose `name` in `building.json` contains at least one non-whitespace character.
- **Route**: The node list returned by `findRoute` from the Route_Start to the selected destination. A Route is active when this list is non-empty.
- **Route_Start**: The node the Route begins at: the Position's `nodeId` when set, otherwise the nearest node to the Position on the Position's floor (the existing `fromId` logic in `App.tsx`).
- **Route_Line**: The polyline drawn through the Route's nodes that lie on the Viewed_Floor, split into separate segments where the Route leaves and re-enters the Viewed_Floor.
- **You_Marker**: The existing pulsing position marker drawn in the Map_View's `you` pane.
- **Destination_Marker**: The existing destination ring, plus a text label showing the destination's name.
- **Start_Marker**: A small marker drawn at the Route_Start node.
- **Focus_Layers**: The pure function in `src/lib/` that takes building data, the Viewed_Floor, the Position, the Route node list, and the destination id, and returns the Route_Line segments, the Destination_Marker data, and the Start_Marker data to draw.
- **Follow_View**: The pure function in `src/lib/` that takes building data, the Viewed_Floor, the Position, and the Route node list, and returns the rectangle the Map_View shows while following, the Upcoming_Nodes it contains, or no view.
- **Upcoming_Nodes**: The longest leading run of the Route's first 5 nodes in which every node exists, lies on the Viewed_Floor, and lies within 20 m (`20 × Plan_Units_Per_Metre` plan units) of the clamped Position on each axis.
- **Follow_Min_Extent**: 20 m in plan units (`20 × Plan_Units_Per_Metre`), the smallest width and height of a Follow_View rectangle when the plan is at least that large.
- **Follow_Max_Extent**: 40 m in plan units (`40 × Plan_Units_Per_Metre`), the largest width and height of a Follow_View rectangle.
- **Follow_Mode**: The Map_View's follow state, either `following` or `paused`. `following` at every app load.
- **Follow_State**: The pure functions in `src/lib/` that compute the next Follow_Mode from a Follow_Mode and an event (`userMove`, `recenter`, `destChange`, `floorChange`, `newAnchor`), decide whether the Recenter_Button is shown, and decide which view change the Map_View applies.
- **User_Map_Move**: A pan or zoom of the map started by the user's input (drag, pinch, double-tap, scroll wheel, or keyboard), as opposed to a view change the Map_View makes itself.
- **Recenter_Button**: The new on-map button with the accessible name "Recenter on my location" that sets Follow_Mode back to `following`.
- **Location_Picker**: The new "I'm at" dropdown in the header that sets a Manual_Anchor on a chosen Named_Place.
- **Destination_Picker**: The existing "Where to?" dropdown in the header, built from `destinationGroups`.
- **Node_Sheet**: The existing bottom sheet opened by tapping a map node, with "Navigate here", "I'm here", and "Cancel" actions. Removed by this feature.
- **Teleport_Mode**: The Debug_Panel checkbox "Tap map to teleport", which moves the Position to the tapped plan point with Position_Source `sim`.
- **Debug_Panel**: The existing Debug section of the bottom panel in `App.tsx`.
- **Relocate_Banner**, **Position_Status**, **Route_Guidance**, **Arrival_Card**: The existing components `RelocateBanner.tsx`, `PositionStatus.tsx`, `RouteGuidance.tsx`, and `ArrivalCard.tsx` in `src/components/`.

## Requirements

### Requirement 1: Floor plan as the base layer

**User Story:** As a user, I want to see the real first-floor plan under my route, so that I can match the map to the hallways around me.

#### Acceptance Criteria

1. WHERE the Viewed_Floor has an `image` in `building.json`, THE Map_View SHALL draw the Floor_Plan stretched exactly over the Viewed_Floor's Plan_Bounds as the lowest visible map layer, at full opacity.
2. WHERE the Viewed_Floor has an `image`, THE Map_View SHALL draw no filled shape between the Floor_Plan and the Route_Line, Destination_Marker, Start_Marker, and You_Marker, so that every part of the Floor_Plan outside those markers and the Route_Line is visible.
3. WHERE the Viewed_Floor has no `image` in `building.json`, THE Map_View SHALL draw the Plan_Outline as the base layer.
4. IF the Floor_Plan fails to load, THEN THE Map_View SHALL draw the Plan_Outline as the base layer for that floor, and SHALL keep drawing the Route_Line, Destination_Marker, Start_Marker, and You_Marker on top.
5. WHEN the Viewed_Floor changes, THE Map_View SHALL replace the previous floor's base layer with the new floor's Floor_Plan or Plan_Outline within 200 ms after the image is available, leaving no base layer from the previous floor visible.
6. THE Floor_Plan and Plan_Outline SHALL be non-interactive, so that taps on them reach the Map_View's map-tap handler used by Teleport_Mode.

### Requirement 2: Show only position, destination, and route

**User Story:** As a user, I want the map to show only where I am, where I'm going, and how to get there, so that I can read my route at a glance.

#### Acceptance Criteria

1. THE Map_View SHALL draw no corridor edge polylines from `building.json` `edges`.
2. THE Map_View SHALL draw no marker for any node other than the Route_Start, the selected destination, and the You_Marker's Position.
3. THE Map_View SHALL draw no permanent text label for any node other than the selected destination.
4. WHILE a destination is selected and the destination node is on the Viewed_Floor, THE Map_View SHALL draw the Destination_Marker at the destination node, with a permanent label showing the same name the Destination_Picker shows for that node (`destinationName`).
5. WHILE a Route is active, THE Map_View SHALL draw the Route_Line through every Route node on the Viewed_Floor in Route order, in a color that contrasts with the Floor_Plan, with a stroke width of at least 5 px.
6. WHILE a Route is active and the Route_Start node is on the Viewed_Floor, THE Map_View SHALL draw the Start_Marker at the Route_Start node, below the You_Marker in drawing order.
7. WHILE a Position is known and the Position's floor equals the Viewed_Floor, THE Map_View SHALL draw the You_Marker at the Position, above the Route_Line, Start_Marker, and Destination_Marker, keeping the existing pulse behavior and reduced-motion behavior from `demo-ux-polish` Requirement 5 criteria 5 and 6.
8. WHILE no destination is selected, THE Map_View SHALL draw only the base layer and, when a Position is known on the Viewed_Floor, the You_Marker.
9. WHILE no Position is known, THE Map_View SHALL draw only the base layer and, when a destination is selected on the Viewed_Floor, the Destination_Marker, with no Route_Line and no Start_Marker.
10. IF a destination is selected and a Position is known but no Route exists, THEN THE Map_View SHALL draw the base layer, the You_Marker, and the Destination_Marker, with no Route_Line and no Start_Marker.
11. WHILE the Arrival_Card is displayed, THE Map_View SHALL draw the Destination_Marker ring in the arrival color, as defined in `demo-ux-polish` Requirement 6 criterion 7.
12. WHEN the Position, the selected destination, the Route, or the Viewed_Floor changes, THE Map_View SHALL redraw the Route_Line, Start_Marker, and Destination_Marker to match the new state within 200 ms, leaving no marker or line from the previous state visible.

### Requirement 3: Focus layer selection logic

**User Story:** As a developer, I want the "what to draw" decision as pure, tested logic, so that I can trust the decluttered map without opening a browser.

#### Acceptance Criteria

1. THE Focus_Layers function SHALL compute its result only from its inputs (building data, Viewed_Floor id, Position or null, Route node id list, destination id or empty string), with no imports from React, Capacitor, or Leaflet and no references to `window` or `document`.
2. FOR ALL inputs, every point in every Route_Line segment returned by Focus_Layers SHALL be the plan coordinates of a Route node on the Viewed_Floor (invariant: the Route_Line contains no non-Route node).
3. FOR ALL inputs, concatenating the Route_Line segments returned by Focus_Layers SHALL yield exactly the Route's Viewed_Floor nodes in Route order, excluding runs of a single node, and a new segment SHALL start exactly where the Route returns to the Viewed_Floor from another floor.
4. FOR ALL inputs, Focus_Layers SHALL return no segment with fewer than 2 points.
5. FOR ALL inputs where the destination id is empty, unknown, or on a floor other than the Viewed_Floor, Focus_Layers SHALL return no Destination_Marker.
6. FOR ALL inputs where the destination id names a node on the Viewed_Floor, Focus_Layers SHALL return a Destination_Marker at that node's coordinates with the label `destinationName` of that node.
7. FOR ALL inputs where the Route node list is empty, Focus_Layers SHALL return no Route_Line segments and no Start_Marker.
8. FOR ALL inputs where the Route is non-empty and its first node is on the Viewed_Floor, Focus_Layers SHALL return a Start_Marker at the first Route node's coordinates; otherwise Focus_Layers SHALL return no Start_Marker.
9. FOR ALL inputs, calling Focus_Layers twice with equal inputs SHALL return equal results (determinism).
10. THE `npm run test:logic` suite SHALL include at least one test for each of criteria 2 through 9, using the existing `tests/prng.ts` helper for generated inputs and no added dependencies.

### Requirement 4: "I'm at" location picker

**User Story:** As a presenter with no Bluetooth, I want to pick where I am from a list, so that I can start a route now that the map no longer shows tappable dots.

#### Acceptance Criteria

1. THE Shortcut_App SHALL display the Location_Picker in the header next to the Destination_Picker, with a placeholder option reading "I'm at…".
2. THE Location_Picker SHALL list exactly the Named_Places, grouped by floor and sorted with the same rules as the Destination_Picker (`destinationGroups`), with each option showing the `destinationName` of its node.
3. WHEN the user selects a Named_Place in the Location_Picker, THE Shortcut_App SHALL call `engine.setAnchor(id, 'manual')`, call `signal.notifyManualAnchor()`, and set the Viewed_Floor to that node's floor.
4. WHEN a Manual_Anchor is set from the Location_Picker, THE Map_View SHALL show the You_Marker at the chosen node within 200 ms, and THE Relocate_Banner SHALL hide within 200 ms if it was displayed.
5. WHEN a Manual_Anchor is set from the Location_Picker while a destination is selected, THE Shortcut_App SHALL recompute the Route from the chosen node and update the Route_Line and Route_Guidance within 200 ms.
6. WHILE the Position's `nodeId` is a Named_Place, THE Location_Picker SHALL show that Named_Place as its selected option, including when the Position was set by Bluetooth or by a deep link.
7. WHILE no Position is known, or the Position's `nodeId` is absent or not a Named_Place, THE Location_Picker SHALL show the placeholder option as selected.
8. WHEN the user selects the placeholder option, THE Shortcut_App SHALL leave the current Position unchanged.
9. THE Location_Picker SHALL stay enabled in every combination of these states: Bluetooth scanning on or off, Signal_Simulation on or off, Relocate_Banner displayed or hidden, Arrival_Card displayed or hidden, Route active or inactive, and Position known or unknown.
10. WHEN the user selects, in the Location_Picker, the node that is the selected destination, THE Shortcut_App SHALL display the Arrival_Card as defined in `demo-ux-polish` Requirement 6 criterion 1.

### Requirement 5: Remove the node sheet and update guidance copy

**User Story:** As a first-time user, I want every hint to point at controls I can actually see, so that I'm never told to tap something that isn't there.

#### Acceptance Criteria

1. THE Shortcut_App SHALL remove the Node_Sheet, and THE Map_View SHALL no longer accept or call an `onNodeTap` callback.
2. WHILE Teleport_Mode is off, WHEN the user taps the map, THE Shortcut_App SHALL leave the Position, the selected destination, and the Viewed_Floor unchanged.
3. WHILE Teleport_Mode is on, WHEN the user taps the map, THE Shortcut_App SHALL set the Position to the tapped plan point on the Viewed_Floor with Position_Source `sim` through `engine.setPoint`.
4. THE Debug_Panel SHALL keep Teleport_Mode as a Debug_Panel-only control that is off each time the Shortcut_App loads.
5. WHILE no Position is known and no destination is selected, THE Route_Guidance SHALL display a hint telling the user to turn on Bluetooth or choose their location from "I'm at".
6. WHILE no Position is known and a destination is selected, THE Route_Guidance SHALL display the destination name and a hint telling the user to choose their location from "I'm at".
7. WHILE a Position is known and no destination is selected, THE Route_Guidance SHALL display a hint telling the user to choose a destination from "Where to?".
8. THE Relocate_Banner SHALL display the text "Bluetooth signal lost" and an instruction telling the user to choose their location from "I'm at", for both the visible text and the screen-reader announcement, with all text fully visible without scrolling or truncation on a viewport 320 px wide or wider.
9. THE Shortcut_App SHALL display no user-facing instructional text that tells the user to tap the map, tap a room, choose "I'm here", or choose "Navigate here". This criterion applies to hints and instructions only; the Position_Status source label defined in criterion 10 and the debug-only Teleport_Mode label "Tap map to teleport" kept by criterion 4 are not covered by this criterion.
10. THE Position_Status SHALL keep displaying the source label "I'm here" for a Position with Position_Source `manual` (`sourceLabel('manual')` returns "I'm here"), with no change to the existing tests that assert this label.

### Requirement 6: Follow the user along the route

**User Story:** As a user walking a route, I want the map to zoom in and move with me, so that I can see my dot and the next turns without pinching and panning.

#### Acceptance Criteria

1. WHILE Follow_Mode is `following` and Follow_View returns a rectangle, THE Map_View SHALL show that rectangle inside the map area with 24 px padding on each side, at no zoom beyond the map's maximum zoom.
2. WHILE Follow_Mode is `following` and Follow_View returns a rectangle, WHEN the Position or the Route changes, THE Map_View SHALL move the view to the new Follow_View rectangle, starting within 100 ms of the change, with an animated pan or zoom lasting at most 300 ms.
3. WHERE the user's system reports `prefers-reduced-motion: reduce`, THE Map_View SHALL apply every view change made by this feature (follow, recenter, plan fit, and reveal) without animation.
4. WHILE Follow_View returns no rectangle, WHEN the Viewed_Floor is first displayed or changes, THE Map_View SHALL fit the Viewed_Floor's Plan_Bounds inside the map area with 10 px padding on each side.
5. WHILE Follow_View returns no rectangle, WHEN a New_Anchor is set on the Viewed_Floor and the You_Marker is outside the visible map area, THE Map_View SHALL pan so that the You_Marker is visible, without changing the zoom level.
6. WHILE Follow_View returns no rectangle, WHEN the Position, the Route, or the selected destination changes without a New_Anchor or Viewed_Floor change, THE Map_View SHALL keep the current view.
7. THE Map_View SHALL keep the plan drawn plan-up, with the top edge of the Floor_Plan at the top of the map area, at every compass heading.
8. IF the Route is empty, the Position is unknown, the Position's floor differs from the Viewed_Floor, or the Viewed_Floor id is not in `building.floors`, THEN THE Follow_View function SHALL return no rectangle.
9. FOR ALL inputs where Follow_View returns a rectangle, the rectangle SHALL lie inside the Viewed_Floor's Plan_Bounds, and the Position and every Upcoming_Node, each after clamping to Plan_Bounds, SHALL lie inside the rectangle (invariant).
10. FOR ALL inputs where Follow_View returns a rectangle, the node list Follow_View reports SHALL equal the Upcoming_Nodes for those inputs.
11. FOR ALL inputs where Follow_View returns a rectangle, the rectangle's width SHALL be at least the smaller of Follow_Min_Extent and the floor `width`, and at most Follow_Max_Extent; and the rectangle's height SHALL be at least the smaller of Follow_Min_Extent and the floor `height`, and at most Follow_Max_Extent.
12. FOR ALL inputs where Follow_View returns a rectangle, on each axis where the rectangle does not touch a Plan_Bounds edge, the rectangle's center SHALL equal the clamped Position on that axis.
13. FOR ALL inputs, calling Follow_View twice with equal inputs SHALL return equal results, and Follow_View SHALL leave its inputs unchanged (determinism).
14. THE Follow_View function SHALL be a pure function in `src/lib/` with no imports from React, Capacitor, or Leaflet and no references to `window` or `document`, and THE `npm run test:logic` suite SHALL include at least one test for each of criteria 8 through 13.

### Requirement 7: Pause and recenter

**User Story:** As a user, I want to look around the map without it snapping back, and get back to following with one tap, so that I stay in control.

#### Acceptance Criteria

1. WHEN a User_Map_Move starts, THE Map_View SHALL set Follow_Mode to `paused`.
2. WHILE Follow_Mode is `paused`, THE Map_View SHALL keep the user's view when the Position or the Route changes.
3. WHEN the Map_View changes the view itself (follow, recenter, plan fit, or reveal), THE Map_View SHALL leave Follow_Mode unchanged.
4. WHILE Follow_Mode is `paused` and Follow_View returns a rectangle, THE Map_View SHALL display the Recenter_Button.
5. WHILE Follow_Mode is `following`, or Follow_View returns no rectangle, THE Map_View SHALL hide the Recenter_Button.
6. WHEN the user activates the Recenter_Button, THE Map_View SHALL set Follow_Mode to `following` and move the view to the current Follow_View rectangle, starting within 100 ms.
7. WHEN the selected destination changes, the Viewed_Floor changes, or a New_Anchor is set, THE Map_View SHALL set Follow_Mode to `following`.
8. THE Map_View SHALL start with Follow_Mode `following` each time the Shortcut_App loads.
9. FOR ALL sequences of Follow_State events starting from `following`, the resulting Follow_Mode SHALL be `paused` if and only if the last event is `userMove`.
10. FOR ALL Follow_Mode values and Follow_View results, the Follow_State function SHALL report the Recenter_Button as shown if and only if Follow_Mode is `paused` and a Follow_View rectangle exists.
11. FOR ALL Follow_Mode values, Follow_View results, and floor-change and New_Anchor flags, the Follow_State function SHALL choose exactly one view change: follow when Follow_Mode is `following` and a Follow_View rectangle exists; otherwise plan fit when the Viewed_Floor was first displayed or changed; otherwise reveal when a New_Anchor was set; otherwise none.
12. THE Follow_State functions SHALL be pure functions in `src/lib/` with no imports from React, Capacitor, or Leaflet, and THE `npm run test:logic` suite SHALL include at least one test for each of criteria 9 through 11.

### Requirement 8: Accessibility and layout

**User Story:** As a user on a small phone or using a screen reader, I want the header pickers and the map buttons to be easy to reach and clearly named, so that I can set where I am, where I'm going, and get back to my dot.

#### Acceptance Criteria

1. THE Location_Picker SHALL have the accessible name "Current location" and THE Destination_Picker SHALL keep the accessible name "Destination".
2. THE Location_Picker, the Destination_Picker, the destination clear button, and the Recenter_Button SHALL each have a touch target of at least 44 by 44 CSS px.
3. WHILE the viewport is 320 px wide or wider, THE header SHALL display the Location_Picker, the Destination_Picker, and the destination clear button with no horizontal scrolling and no overlap between their bounding boxes.
4. THE Location_Picker and Destination_Picker SHALL be reachable and operable with the keyboard in header order, Location_Picker first.
5. THE Destination_Marker label SHALL have a text-to-background contrast ratio of at least 4.5:1 where it overlaps the Floor_Plan.
6. THE Recenter_Button SHALL have the accessible name "Recenter on my location", include the visible text "Recenter", and be operable with the keyboard.
7. WHILE the viewport is 320 px wide or wider, THE Recenter_Button SHALL lie inside the map area with no overlap with the floor buttons (`.floors`) or the map alerts (`.map-alerts`), and pointer input outside the Recenter_Button's bounding box SHALL reach the map.

### Requirement 9: Compatibility and code organization

**User Story:** As a team member, I want this change isolated and safe, so that the polished demo states keep working and merges stay small.

#### Acceptance Criteria

1. THE Shortcut_App SHALL keep the Relocate_Banner, Position_Status, Arrival_Card, You_Marker pulse, destination arrival ring, and Debug "Simulate Bluetooth" behavior defined in `demo-ux-polish`, except for the copy and interaction changes defined in Requirements 4 and 5 of this document.
2. THE Shortcut_App SHALL implement the Location_Picker and the Recenter_Button as new files in `src/components/`, and SHALL place all new UI code for this feature only in `src/App.tsx`, `src/components/*`, and `src/styles.css`.
3. THE Shortcut_App SHALL implement Focus_Layers, Follow_View, and Follow_State in `src/lib/`, importing only other `src/lib/` modules.
4. THE Shortcut_App SHALL change Position only by calling Position_Engine methods, and THE Location_Picker, Recenter_Button, and Map_View SHALL contain no code that assigns Position fields directly.
5. THE Shortcut_App SHALL add no entries to, remove no entries from, and change no version strings in `dependencies` or `devDependencies` in `package.json`.
6. WHEN the feature is complete, THE `npm run typecheck`, `npm run test:logic`, and `npm run build` commands SHALL each exit with code 0, with no existing test deleted, skipped, or modified to change what it asserts.
7. THE Shortcut_App SHALL limit changes to `src/App.tsx` to imports, rendering the Location_Picker, removing the Node_Sheet and its state, and passing props, with no new component definitions inside `src/App.tsx`.
