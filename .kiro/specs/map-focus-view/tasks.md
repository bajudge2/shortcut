# Implementation Plan: map-focus-view

## Overview

Implementation is in TypeScript (React + Leaflet) inside `shortcut/`, following the design. Order keeps merges with the teammate's parallel `App.tsx` edits small:

1. Pure logic in `src/lib/` plus tests, run by the existing plain-Node `npm run test:logic`.
2. New components, copy changes, and CSS. Nothing renders the new components yet.
3. `MapView.tsx` changes (base layer, overlays, follow mode, Recenter_Button).
4. `App.tsx` wiring last, in two small sub-tasks that can each be committed separately.
5. Source-scan tests once the code they scan exists.

`PositionEngine` (`src/positioning/engine.ts`) is not modified. No dependencies are added. Property tests use the seeded generator in `tests/prng.ts`. Each phase ends at a checkpoint that runs `npm run typecheck`, `npm run test:logic`, and `npm run build`.

## Tasks

- [x] 1. Focus layers (`src/lib/focus-layers.ts`)
  - [x] 1.1 Implement `focusLayers` and `routeKey`
    - Export `PlanPoint`, `StartMarkerData`, `DestinationMarkerData`, `FocusLayersResult`, `focusLayers`, and `routeKey` with the signatures in the design
    - Split the Route into on-floor runs, ending a run at any off-floor or unknown id and dropping runs shorter than 2 points. Start marker only when `routeNodes[0]` is on the Viewed_Floor. Destination marker only when the destination is a known node on the Viewed_Floor, labelled with `destinationName`
    - `routeKey` joins ids with `"\u0000"` and returns `""` for an empty list
    - Import only `./types.ts` and `./guidance.ts`. Return fresh arrays and objects; do not mutate inputs
    - _Requirements: 2.4, 2.5, 2.6, 3.1–3.9, 9.3_
  - [x] 1.2 Write example tests for `focusLayers` in `tests/focus.test.ts`
    - Required, because Requirement 3.10 asks for at least one test per criterion 3.2–3.9 even when the optional property tests are skipped
    - Real `building.json`: the Route from `f1_junction_12` (Arena Entrance) to `f1_junction_4` (Crossroads Cafe) from `findRoute` gives one segment equal to the Route's coordinates and a start marker at Arena Entrance (3.2, 3.3, 3.8). A one-node Route gives no segment (3.4). An unknown or empty destination gives no marker, and the cafe gives a marker labelled `destinationName` (3.5, 3.6). An empty Route gives no segments and no start (3.7). Two calls with equal inputs are deep-equal (3.9)
    - Small hand-built building: a Route that leaves the floor and comes back gives two segments (3.3). `routeKey(['a','b']) !== routeKey(['ab'])`
    - _Requirements: 2.4, 2.5, 2.6, 3.2–3.10_
  - [ ]* 1.3 Create the shared generators in `tests/focus-gen.ts`
    - Buildings (1 to 3 floors, sizes 50 to 1000, `image` present or absent, 0 to 8 nodes per floor on a coarse grid, the name pool and all `NodeKind`s from the design, `metersPerUnit` from `{0.05, 0.12192, 0.5, 2}`), floor ids (plus `'ghost'`), Route lists (0 to 12, plus `'nope'`), destination ids, Positions (up to 50 units outside the plan), and Follow event sequences
    - The file name must not match `tests/*.test.ts`, so the runner imports it without running it. Only the optional property tests use it
    - _Requirements: 3.10, 6.14, 7.12_
  - [ ]* 1.4 Write property test: Route_Line segments are the Route's on-floor runs
    - **Property 1: Route_Line segments are the Route's on-floor runs**
    - **Validates: Requirements 2.5, 3.2, 3.3, 3.4**
  - [ ]* 1.5 Write property test: Destination_Marker exactly when the destination is on the Viewed_Floor
    - **Property 2: Destination_Marker exactly when the destination is on the Viewed_Floor**
    - **Validates: Requirements 2.4, 2.8, 3.5, 3.6**
  - [ ]* 1.6 Write property test: Start_Marker exactly when the Route starts on the Viewed_Floor
    - **Property 3: Start_Marker exactly when the Route starts on the Viewed_Floor**
    - **Validates: Requirements 2.6, 2.9, 2.10, 3.7, 3.8**
  - [ ]* 1.7 Write property test: Focus_Layers is deterministic and leaves inputs unchanged
    - **Property 4: Focus_Layers is deterministic and leaves inputs unchanged**
    - **Validates: Requirements 3.1, 3.9**

- [x] 2. Location picker value (`src/lib/guidance.ts`)
  - [x] 2.1 Add `locationPickerValue(groups, position)`
    - Return `position.nodeId` when it is a node listed in some group, otherwise `''`. Leave every existing export unchanged, including `sourceLabel('manual') === "I'm here"`
    - _Requirements: 4.6, 4.7, 5.10_
  - [x] 2.2 Write example tests for `locationPickerValue` in `tests/focus.test.ts`
    - `null` Position, Position with no `nodeId`, an unknown id, and a junction node give `''`. A Position at `f1_junction_4` gives `'f1_junction_4'`
    - _Requirements: 4.6, 4.7_
  - [ ]* 2.3 Write property test: Location_Picker value follows the Position's Named_Place
    - **Property 13: Location_Picker value follows the Position's Named_Place**
    - **Validates: Requirements 4.6, 4.7**

- [x] 3. Follow view (`src/lib/follow-view.ts`)
  - [x] 3.1 Implement `followView` and the `FOLLOW_*` constants
    - Export `PlanRect`, `FollowView`, `FOLLOW_LOOKAHEAD_NODES = 5`, `FOLLOW_MIN_EXTENT_M = 20`, `FOLLOW_MAX_EXTENT_M = 40`, and `followView(building, floorId, position, routeNodes)`
    - Return `null` for an empty Route, a `null` Position, a Position on another floor, an unknown floor, or a `metersPerUnit` that is not finite and > 0
    - Clamp the Position; collect the Upcoming_Nodes (stop at the first missing, unknown, off-floor, or farther-than-20 m-per-axis node); half sizes are the larger of 10 m and the farthest Upcoming_Node per axis; shift each axis into the plan, or use the whole axis when the plan is smaller; `center` is the midpoint
    - Import only `./types.ts` and the `PlanPoint` type from `./focus-layers.ts`. No `window` or `document`. Do not mutate inputs
    - _Requirements: 6.8–6.14, 9.3_
  - [x] 3.2 Write example tests for `followView` in `tests/follow.test.ts`
    - Required, because Requirement 6.14 asks for at least one test per criterion 6.8–6.13
    - `null` for an empty Route, a `null` Position, a Position on `'ghost'`, and an unknown floor id (6.8)
    - Real `building.json`, Position at Arena Entrance with the Route to the cafe: the rectangle is inside 610 × 888, contains the Position, `nodeIds[0] === 'f1_junction_12'`, and each side is between 164.04 and 328.08 units (6.9, 6.10, 6.11). Position at (0, 0): `minX === 0`, `minY === 0`, minimum size kept (6.11, 6.12). A Position in the middle of the plan: `center` equals the Position (6.12). A 50 × 50 plan gives the whole plan (6.11). Two calls are deep-equal and inputs are unchanged (6.13)
    - _Requirements: 6.8–6.14_
  - [ ]* 3.3 Write property test: Follow_View exists exactly when following is possible, and is deterministic
    - **Property 5: Follow_View exists exactly when following is possible, and is deterministic**
    - **Validates: Requirements 6.8, 6.13**
  - [ ]* 3.4 Write property test: Follow_View stays inside the plan and contains the user and the Upcoming_Nodes
    - **Property 6: Follow_View stays inside the plan and contains the user and the Upcoming_Nodes**
    - **Validates: Requirements 6.9**
  - [ ]* 3.5 Write property test: Follow_View reports exactly the Upcoming_Nodes
    - **Property 7: Follow_View reports exactly the Upcoming_Nodes**
    - **Validates: Requirements 6.10**
  - [ ]* 3.6 Write property test: Follow_View size is between the minimum and maximum extent
    - **Property 8: Follow_View size is between the minimum and maximum extent**
    - **Validates: Requirements 6.11**
  - [ ]* 3.7 Write property test: Follow_View is centered on the user away from plan edges
    - **Property 9: Follow_View is centered on the user away from plan edges**
    - **Validates: Requirements 6.12**

- [x] 4. Follow state (`src/lib/follow-state.ts`)
  - [x] 4.1 Implement `stepFollow`, `showRecenter`, and `viewCommand`
    - Export `FollowMode`, `FollowEvent`, `INITIAL_FOLLOW_MODE = 'following'`, `stepFollow` (`userMove` → `paused`, every other event → `following`), `showRecenter` (`paused` and a Follow_View exists), `ViewCommand`, and `viewCommand` with the priority follow → plan → reveal → none
    - Import only types from `./follow-view.ts`
    - _Requirements: 6.1, 6.4, 6.5, 6.6, 7.1, 7.2, 7.6–7.12, 9.3_
  - [x] 4.2 Write example tests for follow state in `tests/follow.test.ts`
    - Required, because Requirement 7.12 asks for at least one test per criterion 7.9–7.11
    - `INITIAL_FOLLOW_MODE === 'following'` (7.8). `stepFollow` table for all 10 mode × event pairs (7.9). `showRecenter` four-row table (7.10). One `viewCommand` example per outcome, including `paused` with a Follow_View and no flags giving `none` (7.11)
    - _Requirements: 7.8–7.12_
  - [ ]* 4.3 Write property test: Follow_Mode is paused exactly after a user move
    - **Property 10: Follow_Mode is paused exactly after a user move**
    - **Validates: Requirements 7.1, 7.6, 7.7, 7.9**
  - [ ]* 4.4 Write property test: Recenter_Button is shown exactly when paused with a Follow_View
    - **Property 11: Recenter_Button is shown exactly when paused with a Follow_View**
    - **Validates: Requirements 7.4, 7.5, 7.10**
  - [ ]* 4.5 Write property test: Exactly one view change, in priority order
    - **Property 12: Exactly one view change, in priority order**
    - **Validates: Requirements 6.1, 6.4, 6.5, 6.6, 7.2, 7.11**

- [x] 5. Checkpoint: pure logic complete
  - Run `npm run typecheck` and `npm run test:logic` in `shortcut/`. Both must exit 0, and the existing `tests/logic.test.ts`, `tests/guidance.test.ts`, and `tests/signal-monitor.test.ts` must be unchanged and passing. Ensure all tests pass, ask the user if questions arise.
  - Suggested commits: focus-layers + tests, guidance helper + tests, follow-view + tests, follow-state + tests.

- [x] 6. New components, copy, and styles (not rendered yet)
  - [x] 6.1 Create `src/components/LocationPicker.tsx`
    - `<select className="loc-picker" aria-label="Current location">` with the `I’m at…` placeholder and one `<optgroup>` per `destinationGroups` floor, options labelled with `destinationName`. Value from `locationPickerValue(groups, position)`. `onChange` calls `onSelect` only for a non-empty value. No `disabled`, no engine access, no Position writes
    - _Requirements: 4.1, 4.2, 4.6–4.9, 8.1, 9.2, 9.4_
  - [x] 6.2 Create `src/components/RecenterButton.tsx`
    - `<button type="button" className="recenter" aria-label="Recenter on my location">` with an `aria-hidden` icon and the visible text "Recenter", calling `onRecenter`
    - _Requirements: 7.6, 8.6, 9.2_
  - [x] 6.3 Update the hints in `src/components/RouteGuidance.tsx`
    - `needPosition`: turn on Bluetooth or choose where you are from “I’m at”. `needPositionForDest`: destination name plus choose where you are from “I’m at”. `needDest`: choose a destination from “Where to?”. Remove any text that says to tap the map or a room
    - _Requirements: 5.5, 5.6, 5.7, 5.9_
  - [x] 6.4 Update the copy in `src/components/RelocateBanner.tsx`
    - Keep the title "Bluetooth signal lost". New body and `ANNOUNCEMENT` point at “I’m at” at the top of the screen. Keep the existing wrapping and the Dismiss button
    - _Requirements: 5.8, 5.9, 9.1_
  - [x] 6.5 Update `src/styles.css`
    - Header: `.top { align-items: center }`, `.top select` flex `1 1 0`, `min-width: 0`, `min-height: 44px`, `font-size: 16px`, ellipsis; `.top .ghost` 44 × 44 px
    - `.dest-label` (white background, near-black 13 px bold text, border, shadow, no tooltip arrow)
    - `.recenter` absolutely positioned bottom-right in `.map-wrap` (z-index 500, at least 44 × 44 px, safe-area bottom inset, visible `:focus-visible` outline), clear of `.floors` and `.map-alerts`
    - Remove `.node-label`, `.sheet-backdrop`, `.sheet`, `.sheet h3`, and `.sheet button`
    - _Requirements: 8.2, 8.3, 8.5, 8.7_

- [x] 7. Map_View changes (`src/components/MapView.tsx`)
  - [x] 7.1 Add the `base` pane and replace the floor drawing with the base layer
    - Create the `base` pane (z-index 250, `pointer-events: none`). Rename the static layer to `baseLayer`. Draw the Floor_Plan `imageOverlay` in the `base` pane at full opacity, or the Plan_Outline when there is no `image`; on the image's `error`, swap in the Plan_Outline unless the floor has changed
    - Remove edge polylines, node dots, node tooltips, the node `click` handler, `KIND_COLOR`, and the `GraphNode`/`NodeKind` imports. Remove the plan `fitBounds` from this effect (task 7.3 owns view changes)
    - Stop destructuring and calling `onNodeTap`, but keep it in `Props` as optional for now so `App.tsx` still compiles; task 9.2 deletes it
    - _Requirements: 1.1–1.6, 2.1, 2.2, 2.3, 5.1_
  - [x] 7.2 Draw the overlays from `focusLayers`
    - Rename the route layer to `focusLayer`. Draw each segment as a 10 px white casing under a 6 px `#dc2626` line, the Start_Marker (radius 6), and the Destination_Marker ring with its permanent `dest-label` tooltip and the `arrived` class when `destinationArrived`
    - Effect deps `[building, floorId, rKey, destinationId, destinationArrived]` with `rKey = routeKey(routeNodes)`
    - _Requirements: 2.4–2.12_
  - [x] 7.3 Add follow mode, user-move detection, and the view effect
    - `mode` state from `INITIAL_FOLLOW_MODE`, `programmatic` and `viewPrev` refs, and `follow = useMemo(followView(...))` keyed on `rKey`
    - At map creation: `movestart` pauses when `programmatic` is false, `dragstart` always pauses, `moveend` clears `programmatic`
    - View effect: derive `floorChanged`, `destChange`, `floorChange`, and `newAnchor` (via `newAnchorNodeId`, only on the Viewed_Floor), fold the events with `stepFollow`, update `mode` if it changed, then apply `viewCommand`: follow `fitBounds` (padding 24, `maxZoom`), plan `fitBounds` (padding 10), reveal `panTo` only when the You_Marker is outside the view, or nothing. Set `programmatic` before each move. Pass `animate: !prefersReducedMotion()`
    - Remove the trailing `panTo` from the You_Marker effect; keep its create/move/pulse logic. No map rotation
    - _Requirements: 4.4, 6.1–6.7, 7.1, 7.2, 7.3, 7.7, 7.8_
  - [x] 7.4 Render the Recenter_Button
    - Return a fragment with the map `<div>` and, when `showRecenter(mode, follow)`, `<RecenterButton onRecenter={() => setMode((m) => stepFollow(m, 'recenter'))} />`
    - _Requirements: 7.4, 7.5, 7.6, 8.7_

- [x] 8. Checkpoint: components ready
  - Run `npm run typecheck`, `npm run test:logic`, and `npm run build`. All three must exit 0, and `noUnusedLocals` must stay clean. Ensure all tests pass, ask the user if questions arise.
  - Suggested commits: LocationPicker + RecenterButton, copy changes, styles, MapView base + overlays, MapView follow mode. `App.tsx` is still untouched at this point.

- [x] 9. `App.tsx` wiring (imports, rendering, props only; each sub-task is one small commit)
  - [x] 9.1 Render `LocationPicker` in the header
    - Import `LocationPicker`. Add the `chooseLocation(id)` handler (look up the node, `engine.setAnchor(id, 'manual')`, `signal.notifyManualAnchor()`, `setViewFloor(node.floor)`). Render `<LocationPicker groups={groups} position={pos} onSelect={chooseLocation} />` before the Destination select. Add `aria-label="Clear destination"` to the ✕ button
    - _Requirements: 4.1, 4.3, 4.4, 4.5, 4.10, 8.1, 8.4, 9.4, 9.7_
  - [x] 9.2 Remove the Node_Sheet
    - Remove the `sheetNode` state, `sheetNodeObj`, the `.sheet-backdrop` JSX, the `nodeLabel` import, and `onNodeTap={setSheetNode}`. Then delete the optional `onNodeTap` from `MapView`'s `Props`
    - _Requirements: 5.1, 5.2, 5.9, 9.7_

- [x] 10. Source-scan tests
  - [x] 10.1 Write `tests/map-focus-copy.test.ts`
    - Required, because these scans are the automated check for Requirements 3.1, 5.1, 5.5–5.9, 6.14, 7.12, 8.1, 8.4, 8.6, and 9.3
    - `src/lib/focus-layers.ts`, `follow-view.ts`, and `follow-state.ts`: only `./` imports, and no `react`, `leaflet`, `@capacitor`, `window`, or `document`
    - `MapView.tsx`: no `onNodeTap`, no `building.edges`, exactly one `bindTooltip`, contains `createPane('base')`, `prefers-reduced-motion`, and `RecenterButton`, and no `setBearing` or `rotate`
    - `App.tsx`: no `sheetNode` or `sheet-backdrop`; contains `aria-label="Destination"`; `<LocationPicker` appears before the Destination select
    - `LocationPicker.tsx`: contains `aria-label="Current location"` and `I’m at…`; no `disabled`, `setAnchor`, `setPoint`, or `engine`. `RecenterButton.tsx`: contains `aria-label="Recenter on my location"`, `Recenter`, and `<button`
    - `RouteGuidance.tsx` contains the three new hints and `RelocateBanner.tsx` the new body and announcement. No file in `src/components/` or `src/App.tsx` matches `/tap (the|a place|a room|where)/i`, `Navigate here`, or choose “I’m here”, with the exact Debug label "Tap map to teleport" excluded
    - _Requirements: 1.6, 2.1–2.3, 3.1, 4.1, 4.9, 5.1, 5.5–5.9, 6.3, 6.7, 6.14, 7.12, 8.1, 8.4, 8.6, 9.3, 9.4_

- [x] 11. Final checkpoint
  - Run `npm run typecheck`, `npm run test:logic`, and `npm run build`. All must exit 0, with no existing test deleted, skipped, or weakened (9.6)
  - `git diff package.json` shows no changes to `dependencies` or `devDependencies` (9.5). `src/positioning/engine.ts` is unchanged. The `App.tsx` diff contains only imports, the `LocationPicker` render and handler, the Node_Sheet removal, and props (9.7)
  - Ensure all tests pass, ask the user if questions arise. Then ask the user to run the manual iPhone Safari checklist from the design.

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP. Tasks 1.2, 2.2, 3.2, 4.2, and 10.1 are not optional, because Requirements 3.10, 6.14, 7.12, and the source-scan criteria need those tests. Task 1.3 is optional because only the property tests use the generators.
- Property tests use `tests/prng.ts` with `forAll` (at least 100 runs). Each test carries the comment `// Feature: map-focus-view, Property N: <title>`.
- No DOM test runner is added. Rendering, Leaflet event wiring, animation, reduced motion, layout, and VoiceOver are checked by hand with the design's manual checklist on iPhone Safari (`npm run dev`).
- Map rotation by heading is out of scope; the map stays plan-up.
- `App.tsx` is touched only in task 9, one sub-task per commit, so each change can be rebased onto the teammate's edits on its own.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.1", "3.1"] },
    { "id": 1, "tasks": ["1.2", "1.3", "3.2", "4.1"] },
    { "id": 2, "tasks": ["2.2", "4.2"] },
    { "id": 3, "tasks": ["1.4", "3.3"] },
    { "id": 4, "tasks": ["1.5", "3.4"] },
    { "id": 5, "tasks": ["1.6", "3.5"] },
    { "id": 6, "tasks": ["1.7", "3.6"] },
    { "id": 7, "tasks": ["2.3", "3.7"] },
    { "id": 8, "tasks": ["4.3"] },
    { "id": 9, "tasks": ["4.4"] },
    { "id": 10, "tasks": ["4.5", "6.1", "6.2", "6.3", "6.4", "6.5"] },
    { "id": 11, "tasks": ["7.1"] },
    { "id": 12, "tasks": ["7.2"] },
    { "id": 13, "tasks": ["7.3"] },
    { "id": 14, "tasks": ["7.4"] },
    { "id": 15, "tasks": ["9.1"] },
    { "id": 16, "tasks": ["9.2"] },
    { "id": 17, "tasks": ["10.1"] }
  ]
}
```
