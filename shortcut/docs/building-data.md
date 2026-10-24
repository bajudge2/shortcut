# Building data

`src/data/building.json` is the only map-data source.

## Schema
- `id`, `name`: building identity.
- `metersPerUnit`: converts plan-coordinate distances to meters.
- `northOffsetDeg`: compass heading (clockwise from north) corresponding to plan-up.
- `floors[]`: `id`, display `label`, numeric `level`, plan `width`/`height`, optional image URL.
- `nodes[]`: `id`, `floor`, `x`, `y`, `kind`, optional destination `name`.
- `edges[]`: undirected `from`/`to` connections with optional `type` (`corridor`, `stairs`, `elevator`).
- `beacons[]`: advertised short `id` mapped to the exact graph `node` where it is mounted.

## Coordinates and invariants
Plan coordinates use x-right/y-down. Nodes and images must share the same coordinate space. Every node must be inside its floor and connected to an edge; every edge and beacon must reference existing nodes. Logic tests enforce these conditions and destination reachability.

Distances on same-floor edges are Euclidean plan distance times `metersPerUnit`. Floor transitions use routing penalties rather than physical walking distance. Measure `northOffsetDeg` in the building with the phone orientation used during navigation.
