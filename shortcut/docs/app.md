# App and components

## `App.tsx`
Owns UI state only: destination, route options, viewed floor, toggles, and debug display. It computes routes using `src/lib/graph.ts` (from the user's node or the nearest node, recomputed on every position change), supplies route nodes to `PositionEngine`, subscribes to position/navigation state, and wires device adapters to engine methods. The header holds the “I’m at” `LocationPicker` (before) and the “Where to?” destination select, plus a ✕ “Clear destination” button. `chooseLocation(id)` is the manual fallback: `engine.setAnchor(id, 'manual')`, hides the signal-lost banner, and switches to that node's floor. There is no node sheet; map nodes are not tappable. The Debug panel keeps “Tap map to teleport” and shows a beacon the engine is ignoring as too far from the step estimate.

## `MapView.tsx`
Leaflet `CRS.Simple` renderer. Converts plan `(x,y)` to `(lng=x, lat=-y)`. Props: `building`, `floorId`, `position`, `routeNodes`, `destinationId`, optional `onMapTap(floor, x, y)` (teleport) and `destinationArrived`.
- **Base layer** in a `base` pane (z 250, no pointer events): the floor image, or a plain outline when there is no image or it fails to load. Corridor edges and node dots are not drawn.
- **Overlays** from `focusLayers()`: red route line over a white casing, a start dot, and the destination ring with its one permanent label (green ring after arrival).
- **You marker**: one persistent divIcon in the `you` pane (z 640); it pulses on a new manual/BLE anchor and its CSS transform transition (350 ms) smooths step updates. Visual only, never fed back into positioning.
- **Follow mode**: while a route is active and the user is on the viewed floor, every change fits the `followView()` rectangle (20–40 m, padding 24). A user pan/zoom (`movestart` not caused by our own move, or `dragstart`) pauses following and shows the `RecenterButton`; destination, floor, or new-anchor changes resume it. Without a follow view it fits the whole plan on first display/floor change, or pans to reveal a new anchor. Animations are off under `prefers-reduced-motion`. The map is always plan-up.

## Other components
- `LocationPicker.tsx`: “I’m at…” `<select aria-label="Current location">` over `destinationGroups`; its value follows the position's named node via `locationPickerValue`; calls `onSelect(id)` only for a real choice. Never writes positions itself.
- `RecenterButton.tsx`: on-map “Recenter” button (`aria-label="Recenter on my location"`), bottom-right of `.map-wrap`.
- `RouteGuidance.tsx`: one hint at a time from `guidanceFor`, turn-by-turn steps, and the arrival card. Hints point at “I’m at” and “Where to?”.
- `RelocateBanner.tsx`: “Bluetooth signal lost” banner telling the user to choose where they are from “I’m at”; dismissible.
- `PositionStatus.tsx`, `ArrivalCard.tsx`, `PoliteAnnouncer.tsx`, `SignalSimControls.tsx`, `useArrival.ts`, `useSignalMonitor.ts`: position status line, arrival card, screen-reader announcements, Debug beacon simulation, and the hooks that drive arrival and signal-lost state.

## Entry/config
- `main.tsx`: mounts React and imports Leaflet/app CSS.
- `config.ts`: BLE UUID/name constants mirrored by firmware plus step length in meters.
- `deeplink.ts`: URL-only `?at=&to=` demo setup parser.
- `capacitor.config.ts`: bundle id/app name/web output directory.

The BLE and motion toggles must be exercised in the native iOS app; browser mode supports map/manual testing only.
