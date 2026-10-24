import { destinationName } from './guidance.ts';
import type { Building, Position } from './types.ts';

/** A point in plan units (x right, y down), same space as building.json nodes. */
export interface PlanPoint { x: number; y: number }
export interface StartMarkerData { nodeId: string; x: number; y: number }
export interface DestinationMarkerData { nodeId: string; x: number; y: number; label: string }

export interface FocusLayersResult {
  /** Route_Line segments; each has >= 2 points, all on the Viewed_Floor, in Route order. */
  segments: PlanPoint[][];
  start: StartMarkerData | null;
  destination: DestinationMarkerData | null;
}

/**
 * What the Map_View draws on top of the base layer (Req 2, 3).
 * The result does not depend on `position` (the Route already starts at the user's node).
 */
export function focusLayers(
  building: Building,
  floorId: string,
  _position: Position | null,
  routeNodes: readonly string[],
  destinationId: string,
): FocusLayersResult {
  const byId = new Map(building.nodes.map((n) => [n.id, n]));

  // Split the Route into on-floor runs; an off-floor or unknown id ends the run.
  const segments: PlanPoint[][] = [];
  let run: PlanPoint[] = [];
  const close = () => {
    if (run.length >= 2) segments.push(run);
    run = [];
  };
  for (const id of routeNodes) {
    const n = byId.get(id);
    if (n && n.floor === floorId) run.push({ x: n.x, y: n.y });
    else close();
  }
  close();

  const first = routeNodes.length > 0 ? byId.get(routeNodes[0]) : undefined;
  const start = first && first.floor === floorId ? { nodeId: first.id, x: first.x, y: first.y } : null;

  const d = destinationId ? byId.get(destinationId) : undefined;
  const destination = d && d.floor === floorId
    ? { nodeId: d.id, x: d.x, y: d.y, label: destinationName(d) }
    : null;

  return { segments, start, destination };
}

/** Stable key for a Route node list (ids joined with "\u0000"); "" for an empty Route. */
export function routeKey(routeNodes: readonly string[]): string {
  return routeNodes.join('\u0000');
}
