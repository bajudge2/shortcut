import { nodeLabel } from './graph.ts';
import type { Building, Floor, GraphNode, Position, PositionSource } from './types.ts';

/** A node counts as "named" when its name has at least one non-whitespace character. */
function isNamed(n: GraphNode): n is GraphNode & { name: string } {
  return typeof n.name === 'string' && n.name.trim().length > 0;
}

export interface Landmark { node: GraphNode; label: string }

/** Nearest node on `floor` matching `accept`; strict `<` keeps the first in building.nodes on ties. */
function nearestOnFloor(
  building: Building,
  floor: string,
  x: number,
  y: number,
  accept: (n: GraphNode) => boolean,
): GraphNode | null {
  let best: GraphNode | null = null;
  let bd = Infinity;
  for (const n of building.nodes) {
    if (n.floor !== floor || !accept(n)) continue;
    const d = Math.hypot(n.x - x, n.y - y);
    if (d < bd) { bd = d; best = n; }
  }
  return best;
}

/** Nearest named node on `floor` by Euclidean plan distance; ties -> first in building.nodes.
 *  Falls back to the nearest node of any kind (label via nodeLabel). Null if the floor has no nodes. */
export function nearestLandmark(building: Building, floor: string, x: number, y: number): Landmark | null {
  const named = nearestOnFloor(building, floor, x, y, isNamed);
  if (named) return { node: named, label: named.name! };
  const any = nearestOnFloor(building, floor, x, y, () => true);
  return any ? { node: any, label: nodeLabel(any) } : null;
}

const SOURCE_LABELS: Record<PositionSource, string> = {
  ble: 'Bluetooth',
  manual: "I'm here",
  pdr: 'Steps',
  sim: 'Teleport',
};

export function sourceLabel(source: PositionSource): string {
  return SOURCE_LABELS[source];
}

/** { near: "You are near Crossroads Cafe", source: "Bluetooth", landmarkId } or null (Req 5.1–5.3, 5.10). */
export function positionStatusText(
  building: Building,
  pos: Position | null,
): { near: string; source: string; landmarkId: string } | null {
  if (!pos) return null;
  const lm = nearestLandmark(building, pos.floor, pos.x, pos.y);
  if (!lm) return null;
  return { near: `You are near ${lm.label}`, source: sourceLabel(pos.source), landmarkId: lm.node.id };
}

/** Name shown in the picker and the route header (Req 7.3). n.name if non-empty, else nodeLabel(n). */
export function destinationName(n: GraphNode): string {
  return isNamed(n) ? n.name : nodeLabel(n);
}

export interface DestinationGroup { floor: Floor; nodes: GraphNode[] }

/** Code-unit comparison (no localeCompare) so ordering is deterministic across runtimes. */
function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Named nodes grouped in building.floors order, sorted case-insensitively by name then id; empty groups omitted. */
export function destinationGroups(building: Building): DestinationGroup[] {
  const groups: DestinationGroup[] = [];
  for (const floor of building.floors) {
    const nodes = building.nodes
      .filter((n) => n.floor === floor.id && isNamed(n))
      .sort((a, b) => cmp(a.name!.toLowerCase(), b.name!.toLowerCase()) || cmp(a.id, b.id));
    if (nodes.length) groups.push({ floor, nodes });
  }
  return groups;
}

export type Guidance =
  | { kind: 'needPosition' }                          // 3.7
  | { kind: 'needPositionForDest'; destName: string } // 7.1
  | { kind: 'needDest' }                              // 7.2
  | { kind: 'noRoute'; destName: string }             // 3.6, 7.6
  | { kind: 'route'; destName: string }               // 7.3
  | { kind: 'arrived'; destName: string };            // 6.1

/** Single guidance selector: one tagged value means at most one hint at a time (Req 7.7). */
export function guidanceFor(i: {
  positionKnown: boolean;
  destName: string | null; // null when no destination selected
  hasRoute: boolean;
  arrived: boolean;        // ArrivalState.shown
}): Guidance {
  if (!i.positionKnown) {
    return i.destName === null ? { kind: 'needPosition' } : { kind: 'needPositionForDest', destName: i.destName };
  }
  if (i.destName === null) return { kind: 'needDest' };
  if (i.arrived) return { kind: 'arrived', destName: i.destName };
  if (!i.hasRoute) return { kind: 'noRoute', destName: i.destName };
  return { kind: 'route', destName: i.destName };
}
