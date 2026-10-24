# App and components

## `App.tsx`
Owns UI state only: destination, route options, viewed floor, toggles, debug display, and sheets. It computes routes using `src/lib/graph.ts`, supplies route nodes to `PositionEngine`, subscribes to position/navigation state, and wires device adapters to engine methods. It shows arrival/no-route/wrong-way states and retains manual “I’m here” as fallback.

## `MapView.tsx`
Leaflet `CRS.Simple` renderer. Converts plan `(x,y)` to `(lng=x, lat=-y)`, overlays the floor image, graph, route, destination, and user marker. The retained DOM user marker transitions over 350 ms for visual smoothness; this animation does not feed back into route or position calculations.

## Entry/config
- `main.tsx`: mounts React and imports Leaflet/app CSS.
- `config.ts`: BLE UUID/name constants mirrored by firmware plus step length in meters.
- `deeplink.ts`: URL-only `?at=&to=` demo setup parser.
- `capacitor.config.ts`: bundle id/app name/web output directory.

The BLE and motion toggles must be exercised in the native iOS app; browser mode supports map/manual testing only.
