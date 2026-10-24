import type { Building, Position } from './types.ts';
import type { PlanPoint } from './focus-layers.ts';

/** Axis-aligned rectangle in plan units, minX <= maxX and minY <= maxY. */
export interface PlanRect { minX: number; minY: number; maxX: number; maxY: number }

export interface FollowView {
  rect: PlanRect;
  /** Midpoint of rect. Equals the clamped Position on each axis where rect does not touch a plan edge. */
  center: PlanPoint;
  /** The Upcoming_Nodes contained in rect, in Route order. */
  nodeIds: string[];
}

export const FOLLOW_LOOKAHEAD_NODES = 5; // Route nodes considered, starting at the Route_Start
export const FOLLOW_MIN_EXTENT_M = 20;
export const FOLLOW_MAX_EXTENT_M = 40;

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

/** Place [c - h, c + h] inside [0, size], or use the whole axis when the plan is smaller. */
function fitAxis(c: number, h: number, size: number): [number, number] {
  if (2 * h >= size) return [0, size];
  const lo = Math.min(Math.max(c - h, 0), size - 2 * h);
  return [lo, lo + 2 * h];
}

/**
 * The rectangle the map follows: centered on the user, 20–40 m across, keeping the
 * next few Route nodes in view, always inside the plan. Null when following is not
 * possible (Req 6.8).
 */
export function followView(
  building: Building,
  floorId: string,
  position: Position | null,
  routeNodes: readonly string[],
): FollowView | null {
  if (routeNodes.length === 0 || !position || position.floor !== floorId) return null;
  const floor = building.floors.find((f) => f.id === floorId);
  if (!floor) return null;
  const mpu = building.metersPerUnit;
  if (!Number.isFinite(mpu) || mpu <= 0) return null;

  const W = floor.width;
  const H = floor.height;
  const u = 1 / mpu;
  const c = { x: clamp(position.x, 0, W), y: clamp(position.y, 0, H) };
  const minHalf = (FOLLOW_MIN_EXTENT_M * u) / 2;
  const maxHalf = (FOLLOW_MAX_EXTENT_M * u) / 2;

  const byId = new Map(building.nodes.map((n) => [n.id, n]));
  const nodeIds: string[] = [];
  let hx = minHalf;
  let hy = minHalf;
  for (let i = 0; i < Math.min(FOLLOW_LOOKAHEAD_NODES, routeNodes.length); i++) {
    const n = byId.get(routeNodes[i]);
    if (!n || n.floor !== floorId) break;
    const q = { x: clamp(n.x, 0, W), y: clamp(n.y, 0, H) };
    const dx = Math.abs(q.x - c.x);
    const dy = Math.abs(q.y - c.y);
    if (dx > maxHalf || dy > maxHalf) break;
    nodeIds.push(n.id);
    hx = Math.max(hx, dx);
    hy = Math.max(hy, dy);
  }

  const [minX, maxX] = fitAxis(c.x, hx, W);
  const [minY, maxY] = fitAxis(c.y, hy, H);
  return {
    rect: { minX, minY, maxX, maxY },
    center: { x: (minX + maxX) / 2, y: (minY + maxY) / 2 },
    nodeIds,
  };
}
