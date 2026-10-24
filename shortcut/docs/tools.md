# Tools

## `tools/trace-plan.html`
Standalone browser utility for tracing the floor-plan image into `building.json` coordinates. It supports pan/zoom, node and edge editing, metadata, scale calibration (`metersPerUnit`), north offset, JSON import/export, and plan rendering.

The tracing tool does not run inside the app. Exported map data must be reviewed and placed in `src/data/building.json`; that file remains the sole runtime map source. Run `npm run test:logic` after every map edit to catch invalid references, off-plan/unconnected nodes, and unreachable destinations.
