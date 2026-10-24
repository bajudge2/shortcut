# Implementation Plan: demo-ux-polish

## Overview

Implementation is in TypeScript (React + Leaflet) inside `shortcut/`, following the design. Order is chosen so merges with the teammate's parallel `App.tsx` edits stay small:

1. Pure logic in `src/lib/` plus tests, run by the existing plain-Node `npm run test:logic`.
2. Standalone components, hooks, and CSS in new files. Nothing renders them yet.
3. `MapView.tsx` changes.
4. `App.tsx` wiring last, in small steps that can each be committed separately.

`PositionEngine` (`src/positioning/engine.ts`) is not modified. No dependencies are added. Property tests use the seeded generator in `tests/prng.ts`. Each phase ends at a checkpoint that runs `npm run typecheck`, `npm run test:logic`, and `npm run build`.

## Tasks

- [x] 1. Shared constants and test helper
  - [x] 1.1 Add timing constants to `src/config.ts`
    - Add `SIGNAL_QUIET_THRESHOLD_MS = 15_000` and `ARRIVAL_DWELL_MS = 3_000` with doc comments. This is the only place either value is defined
    - _Requirements: 1.2, 6.8, 8.6_
  - [x] 1.2 Create the seeded property-test helper `tests/prng.ts`
    - `mulberry32(seed)`, `int(lo, hi)`, `pick(arr)`, `bool()`, `array(gen, lo, hi)`, `forAll(name, gen, prop, { runs = 100, seed })`
    - On failure, throw with the seed, run index, and JSON of the failing case. Seed defaults to a fixed value and can be overridden with `PBT_SEED`
    - The file name must not match `tests/*.test.ts`, so the runner imports it without running it
    - _Requirements: 1.15, 8.4_

- [x] 2. Signal monitor (`src/lib/signal-monitor.ts`)
  - [x] 2.1 Implement the reducer, query, and `SignalMonitor` class
    - `SignalInput`, `SignalState`, `INITIAL_SIGNAL_STATE`, `applySignalInput`, `querySignal`, `SignalMonitor` (constructor threshold defaults to `SIGNAL_QUIET_THRESHOLD_MS`, throws `RangeError` when the value is not finite and positive)
    - Follow the transition table in the design. Ignore inputs whose `t` is non-integer or earlier than `lastT`. Inputs other than turn-on are ignored entirely while scanning is off. Queries answer as of `max(t, lastT)` and advance `lastT`
    - Import only `../config.ts`. No `window`, `document`, `navigator`, `setTimeout`, `setInterval`, or `Date.now`
    - _Requirements: 1.1–1.14, 8.2, 8.6_
  - [ ]* 2.2 Write property test: signal monitor matches the history model
    - **Property 1: Signal monitor matches the history model**
    - **Validates: Requirements 1.2, 1.5, 1.6, 1.7, 1.8, 1.9, 1.10, 1.11, 2.9, 4.2, 4.6, 4.7**
    - Write it in `tests/signal-monitor.test.ts` with an independent `lostRef` model over the input history
  - [ ]* 2.3 Write property test: scanning off is inert
    - **Property 2: Scanning off is inert**
    - **Validates: Requirements 1.3, 1.4**
  - [ ]* 2.4 Write property test: stale inputs and queries are ignored
    - **Property 3: Stale inputs and queries are ignored**
    - **Validates: Requirements 1.12**
  - [ ]* 2.5 Write property test: a heard beacon guarantees a full quiet window
    - **Property 4: A heard beacon guarantees a full quiet window**
    - **Validates: Requirements 1.13**
  - [ ]* 2.6 Write property test: queries are idempotent
    - **Property 5: Queries are idempotent**
    - **Validates: Requirements 1.14**
  - [x] 2.7 Write example tests for the signal monitor
    - Required, because Requirement 1.15 asks for at least one test per criterion 1.2–1.14 even when the optional property tests are skipped
    - Default threshold: lost at `t0 + 15000`, not lost at `t0 + 14999` (1.2, 1.8). Off means not lost and ignores inputs (1.3, 1.4). Repeated turn-on keeps the quiet start (1.5). A non-null beacon clears lost and suppression (1.6). Repeated nulls keep the quiet start (1.7). Suppression survives 100 null reports after `manualAnchor` and after `dismiss` (1.9, 1.10). Turning scanning off and back on starts fresh (1.11). Stale timestamps are ignored (1.12). No lost flag inside a full window after a beacon (1.13). Same-timestamp queries match (1.14)
    - Source scan of `src/lib/signal-monitor.ts` asserting the forbidden identifiers are absent and the only import is `../config.ts` (1.1, 8.2)
    - _Requirements: 1.1–1.15, 8.2_

- [x] 3. Anchor detection and arrival state machine
  - [x] 3.1 Implement `newAnchorNodeId` in `src/lib/anchor.ts`
    - Returns `next.nodeId` when `next` is `manual` or `ble`, has a `nodeId`, and `prev` is null or differs in `timestamp`, `source`, or `nodeId`. Returns null in every other case, including all `pdr` and `sim` Positions
    - _Requirements: 5.5, 6.10_
  - [x] 3.2 Implement `stepArrival` and `arrivalDeadline` in `src/lib/arrival.ts`
    - `ArrivalState`, `ArrivalInput`, `INITIAL_ARRIVAL_STATE`. Use the algorithm from the design with `dwellMs` defaulting to `ARRIVAL_DWELL_MS`. Hidden states keep `appearance`
    - _Requirements: 6.1, 6.3, 6.5, 6.6, 6.8, 6.9, 6.10_
  - [ ]* 3.3 Write property test: arrival is shown at the destination and never without one
    - **Property 9: Arrival is shown at the destination and never without one**
    - **Validates: Requirements 6.1, 6.6**
    - Write it in `tests/arrival.test.ts`
  - [ ]* 3.4 Write property test: one appearance per Hidden-to-Shown transition
    - **Property 10: One appearance per Hidden-to-Shown transition**
    - **Validates: Requirements 6.3, 6.5, 6.9**
  - [ ]* 3.5 Write property test: drift dwell
    - **Property 11: Drift dwell**
    - **Validates: Requirements 6.8, 6.9**
  - [ ]* 3.6 Write property test: an anchor elsewhere or a new destination hides the card immediately
    - **Property 12: Anchor elsewhere or new destination hides immediately**
    - **Validates: Requirements 6.10, 6.1**
  - [ ]* 3.7 Write example tests for arrival
    - Arrive, drift 2.9 s, return: same appearance. Drift 3.0 s: hidden. "I'm here" elsewhere: hidden in one step. "Done" (`destId ''`): hidden. Selecting the current start node as the destination: shown
    - _Requirements: 6.1, 6.6, 6.8, 6.9, 6.10_

- [x] 4. Guidance helpers (`src/lib/guidance.ts`)
  - [x] 4.1 Implement `nearestLandmark`, `sourceLabel`, `positionStatusText`, `destinationName`, `destinationGroups`, and `guidanceFor`
    - Nearest named node by Euclidean distance with ties going to the first in `building.nodes`. Fall back to the nearest node of any kind, labelled with `nodeLabel`. Return null when the floor has no nodes
    - `destinationGroups`: floors in `building.floors` order, named nodes only (at least one non-whitespace character), sorted by lower-cased name with ties broken by id using code-unit comparison, empty groups omitted
    - `guidanceFor` decision order: needPosition, needPositionForDest, needDest, arrived, noRoute, route
    - Leave the existing `destinations()` in `graph.ts` unchanged
    - _Requirements: 3.6, 3.7, 5.1, 5.2, 5.3, 5.10, 5.11, 7.1–7.7_
  - [x] 4.2 Write example tests for guidance in `tests/guidance.test.ts`
    - Required, because Requirement 5.11 asks for these tests
    - `nearestLandmark`: nearest named node with the tie-break by `building.json` order (5.1), fallback to the nearest unnamed node's `nodeLabel` (5.2), null for a floor with no nodes (5.10). The real `building.json` near `f1_junction_4` returns "Crossroads Cafe"
    - `sourceLabel` for all four sources (5.3). `destinationGroups` on `building.json` returns one "Floor 1" group sorted A to Z
    - _Requirements: 5.1, 5.2, 5.3, 5.10, 5.11, 7.4_
  - [ ]* 4.3 Write property test: nearest landmark matches brute force
    - **Property 6: Nearest landmark matches brute force**
    - **Validates: Requirements 5.1, 5.2, 5.10, 5.11**
  - [ ]* 4.4 Write property test: status text depends only on landmark and source
    - **Property 7: Status text depends only on landmark and source**
    - **Validates: Requirements 5.1, 5.3, 5.8, 5.9**
  - [ ]* 4.5 Write property test: only new manual or Bluetooth anchors count as anchors
    - **Property 8: Only new manual or Bluetooth anchors count as anchors**
    - **Validates: Requirements 5.5, 6.10**
    - Tests `newAnchorNodeId` from `src/lib/anchor.ts`
  - [ ]* 4.6 Write property test: exactly one guidance state, consistent with inputs
    - **Property 13: Exactly one guidance state, consistent with inputs**
    - **Validates: Requirements 3.6, 3.7, 7.1, 7.2, 7.3, 7.6, 7.7**
  - [ ]* 4.7 Write property test: destination picker grouping
    - **Property 14: Destination picker grouping**
    - **Validates: Requirements 7.3, 7.4, 7.5**

- [ ] 5. Engine anchor behavior (tests only, engine unchanged)
  - [ ]* 5.1 Write property test: anchors through the engine replace any prior Position
    - **Property 15: Anchors through the engine replace any prior Position**
    - **Validates: Requirements 3.2, 4.5, 4.10**
    - Write it in `tests/engine-anchor.test.ts` against the real `building.json`. Include the example that `onBeacon('B1')` lands on `f1_junction_15` with source `ble`

- [x] 6. Checkpoint: pure logic complete
  - Run `npm run typecheck` and `npm run test:logic` in `shortcut/`. Both must exit 0, and the existing `tests/logic.test.ts` must be unchanged and passing. Ensure all tests pass, ask the user if questions arise.
  - Suggested commits: constants + prng, signal monitor + tests, anchor/arrival + tests, guidance + tests, engine test.

- [x] 7. Standalone components, hooks, and styles (new files, not rendered yet)
  - [x] 7.1 Add the feature styles to `src/styles.css`
    - `--arrival` color, `.map-alerts` flex column (with `.map-alerts .toast { position: static }`), `.relocate`, `.relocate-dismiss` (min 44 × 44 px), `.pos-status`, `.arrival` (24 px heading, 22 px name, `arrival-in` 600 ms, 1 iteration), `.dest-ring.arrived`, `.you-marker` / `.you-halo` / `.you-dot`, `.you-marker.pulse` (`you-pulse` 1.2 s), `.sr-only`, and a `prefers-reduced-motion: reduce` block that removes both animations
    - Banner text wraps with no truncation at 320 px
    - _Requirements: 2.3, 2.6, 2.11, 5.5, 5.6, 6.2, 6.3, 6.4, 6.7_
  - [x] 7.2 Create `src/components/PoliteAnnouncer.tsx`
    - Always-mounted `.sr-only` `role="status"` region showing `message`
    - _Requirements: 2.10, 5.8, 6.5_
  - [x] 7.3 Create `src/components/RelocateBanner.tsx`
    - Always mounted. When `visible`, show "Bluetooth signal lost", the "I'm here" instruction, and a `Dismiss` button. The announcer message is set only while visible. No focus changes
    - _Requirements: 2.3, 2.6, 2.10, 8.1, 8.3_
  - [x] 7.4 Create `src/components/PositionStatus.tsx`
    - Persistent polite live region holding the `positionStatusText` output. Empty when the result is null. Outside the region, a floor button when `position.floor !== viewFloor` that calls `onShowFloor`
    - _Requirements: 5.1–5.4, 5.8–5.10, 8.1, 8.3_
  - [x] 7.5 Create `src/components/ArrivalCard.tsx`
    - Always mounted with its own announcer. When visible, render the card keyed by `appearance` with "You've arrived", the destination name, and a "Done" button
    - _Requirements: 6.2, 6.3, 6.5, 6.6, 8.1, 8.3_
  - [x] 7.6 Create `src/components/RouteGuidance.tsx`
    - Compute `guidanceFor` and render exactly one hint, no-route message, or route summary with steps, using `destinationName` for the header. Always render `ArrivalCard` with `visible = kind === 'arrived'`
    - Copy the existing summary and step markup from `App.tsx`. Do not edit `App.tsx` yet
    - _Requirements: 3.6, 3.7, 6.1, 7.1, 7.2, 7.3, 7.6, 7.7_
  - [x] 7.7 Create `src/components/SignalSimControls.tsx`
    - "Simulate Bluetooth" checkbox that can be disabled. While on, show one button per beacon id and "Quiet: N s · Signal lost: Yes/No". Any threshold text is derived from `SIGNAL_QUIET_THRESHOLD_MS`
    - _Requirements: 4.1, 4.4, 4.6, 4.8, 8.3, 8.6_
  - [x] 7.8 Create `src/components/useSignalMonitor.ts`
    - One `SignalMonitor` held in a ref, with `now = Math.floor(performance.now())`. `reportBeacon` has a stable identity and feeds both the monitor and `engine.onBeacon` (the same path for real and simulated reports)
    - Scanning effect on `realBleOn || simOn`. A 1000 ms null tick while `simOn`, cleared on turn-off and on unmount. Turn simulation off when real BLE turns on. A 250 ms refresh while scanning. Synchronous refresh after `notifyManualAnchor` and `dismiss`. `simDisabled = realBleOn`
    - _Requirements: 2.1, 2.5, 2.7, 2.8, 4.2, 4.3, 4.5, 4.6, 4.7, 4.8, 4.9, 4.10_
  - [x] 7.9 Create `src/components/useArrival.ts`
    - Run `stepArrival` on changes to `startId`, `destId`, or `position`, using `newAnchorNodeId(prevPos, position)`. Schedule a single `setTimeout` to `arrivalDeadline`, clear it on the next step and on unmount, and re-run the step with the current inputs when it fires
    - _Requirements: 6.1, 6.8, 6.9, 6.10_

- [x] 8. Map_View changes (`src/components/MapView.tsx`)
  - [x] 8.1 Add the `you` pane and a persistent pulsing position marker
    - Create the `you` pane (z-index 640, `pointer-events: none`). Replace the current user marker with a single `L.marker` that uses the `you-marker` divIcon (`interactive: false`, `keyboard: false`) and moves with `setLatLng`. Remove it when there is no Position or the Position is on another floor
    - Pulse: when `newAnchorNodeId(prevPos, position)` is non-null, restart the `pulse` class (remove, reflow, add) and remove it on `animationend`
    - _Requirements: 2.4, 2.12, 3.3, 5.5, 5.6, 5.7_
  - [x] 8.2 Add the optional `destinationArrived` prop for the destination ring
    - Use ring class `dest-ring arrived` when true, and add the prop to that effect's dependencies. Existing call sites still compile
    - _Requirements: 6.7_

- [x] 9. Checkpoint: components ready
  - Run `npm run typecheck`, `npm run test:logic`, and `npm run build`. All three must exit 0, and `noUnusedLocals` must stay clean. Ensure all tests pass, ask the user if questions arise.
  - Suggested commits: styles, each component/hook, MapView. `App.tsx` is still untouched at this point.

- [x] 10. `App.tsx` wiring (imports, hook calls, rendering, props only; each sub-task is one small commit)
  - [x] 10.1 Wire `useSignalMonitor` and the Debug simulation
    - `const signal = useSignalMonitor({ engine, realBleOn: bleOn })`. Pass `signal.reportBeacon` as `onBeacon` in `ble.start`. Render `SignalSimControls` in the Debug panel
    - _Requirements: 4.1–4.10, 8.7_
  - [x] 10.2 Render `RelocateBanner` and update the "I'm here" handler
    - Wrap the banner and the existing toast in `<div className="map-alerts">`. The "I'm here" handler calls `engine.setAnchor(id, 'manual')`, `signal.notifyManualAnchor()`, `setViewFloor(node.floor)`, and `setSheetNode(null)`
    - _Requirements: 2.1, 2.2, 2.4, 2.5, 2.7, 2.8, 2.9, 2.11, 3.1–3.4, 8.7_
  - [x] 10.3 Render `PositionStatus` in the panel
    - Pass `building`, `pos`, `viewFloor`, and `onShowFloor={setViewFloor}`
    - _Requirements: 5.1–5.4, 5.8–5.10, 8.7_
  - [x] 10.4 Switch the destination picker to `destinationGroups`
    - One `<optgroup>` per floor with `destinationName(n)` labels. Drop imports that are no longer used
    - _Requirements: 7.3, 7.4, 7.5, 8.7_
  - [x] 10.5 Wire `useArrival`, `RouteGuidance`, and the arrival ring
    - `const arrival = useArrival({ startId: fromId, destId: dest, position: pos })`. Replace the inline hint, no-route, summary, steps, and arrival block with `RouteGuidance` using `onDone={() => setDest('')}`. Pass `destinationArrived={arrival.shown}` to `MapView`. Remove the old `fromId === dest` check
    - _Requirements: 3.5, 3.6, 3.7, 6.1, 6.6, 6.7, 6.8, 6.10, 7.1, 7.2, 7.3, 7.6, 7.7, 8.7_

- [x] 11. Final checkpoint
  - Run `npm run typecheck`, `npm run test:logic`, and `npm run build`. All must exit 0, with no existing test deleted, skipped, or weakened (8.5)
  - `git diff package.json` shows no changes to `dependencies` or `devDependencies` (8.4). A search of `src/` finds no 15-second threshold literal outside `src/config.ts` (8.6). `src/positioning/engine.ts` is unchanged (8.3)
  - Ensure all tests pass, ask the user if questions arise. Then ask the user to run the manual iPhone Safari checklist and the teammate's native BLE check (see Notes).

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP. Tasks 2.7 and 4.2 are not optional, because Requirements 1.15 and 5.11 require those tests.
- Property tests use `tests/prng.ts` with `forAll` (at least 100 runs). Each test carries the comment `// Feature: demo-ux-polish, Property N: <title>`.
- No DOM test runner is added. Layout, animation, focus, and announcement criteria are checked by hand:
  - iPhone Safari on `npm run dev`, using the design's checklist: Debug → Simulate Bluetooth, banner at 15 s, "I'm here" recovery, B1/B2/B3 snaps, Dismiss, the floor button, arrival drift and Done, Reduce Motion, and a 320 px width.
  - Real BLE (2.8, 4.8, 4.9) on the teammate's Xcode build.
- `App.tsx` is touched only in task 10, one sub-task per commit, so each change can be rebased onto the teammate's edits on its own.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2"] },
    { "id": 1, "tasks": ["2.1", "3.1", "4.1", "5.1"] },
    { "id": 2, "tasks": ["2.2", "3.2", "4.2"] },
    { "id": 3, "tasks": ["2.3", "3.3", "4.3"] },
    { "id": 4, "tasks": ["2.4", "3.4", "4.4"] },
    { "id": 5, "tasks": ["2.5", "3.5", "4.5"] },
    { "id": 6, "tasks": ["2.6", "3.6", "4.6"] },
    { "id": 7, "tasks": ["2.7", "3.7", "4.7"] },
    { "id": 8, "tasks": ["7.1", "7.2", "7.7", "7.8", "7.9"] },
    { "id": 9, "tasks": ["7.3", "7.4", "7.5"] },
    { "id": 10, "tasks": ["7.6", "8.1"] },
    { "id": 11, "tasks": ["8.2"] },
    { "id": 12, "tasks": ["10.1"] },
    { "id": 13, "tasks": ["10.2"] },
    { "id": 14, "tasks": ["10.3"] },
    { "id": 15, "tasks": ["10.4"] },
    { "id": 16, "tasks": ["10.5"] }
  ]
}
```
