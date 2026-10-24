import type { Building, DirectionStep, EdgeType, GraphEdge, GraphNode, Route } from './types.ts';

/** Cost (in meters-equivalent) of changing floors, so routes prefer fewer floor changes. */
const FLOOR_CHANGE_COST: Record<'stairs' | 'elevator', number> = { stairs: 12, elevator: 8 };

export interface BuildingIndex {
  building: Building;
  nodeById: Map<string, GraphNode>;
  adj: Map<string, { to: string; cost: number; type: EdgeType }[]>;
}

export function edgeType(b: Building, e: GraphEdge): EdgeType {
  if (e.type) return e.type;
  const a = b.nodes.find((n) => n.id === e.from);
  const c = b.nodes.find((n) => n.id === e.to);
  return a && c && a.floor !== c.floor ? 'stairs' : 'corridor';
}

export function indexBuilding(building: Building): BuildingIndex {
  const nodeById = new Map(building.nodes.map((n) => [n.id, n]));
  const adj: BuildingIndex['adj'] = new Map(building.nodes.map((n) => [n.id, []]));
  for (const e of building.edges) {
    const a = nodeById.get(e.from);
    const c = nodeById.get(e.to);
    if (!a || !c) throw new Error(`Edge references unknown node: ${e.from} -> ${e.to}`);
    const type = edgeType(building, e);
    const cost =
      type === 'corridor'
        ? Math.hypot(a.x - c.x, a.y - c.y) * building.metersPerUnit
        : FLOOR_CHANGE_COST[type];
    adj.get(a.id)!.push({ to: c.id, cost, type });
    adj.get(c.id)!.push({ to: a.id, cost, type });
  }
  return { building, nodeById, adj };
}

/** Dijkstra. The graph is tiny, so a linear-scan priority queue is plenty. */
export function findRoute(
  idx: BuildingIndex,
  fromId: string,
  toId: string,
  opts: { accessible?: boolean } = {},
): Route | null {
  if (!idx.nodeById.has(fromId) || !idx.nodeById.has(toId)) return null;
  const dist = new Map<string, number>([[fromId, 0]]);
  const prev = new Map<string, string>();
  const open = new Set<string>([fromId]);
  const done = new Set<string>();

  while (open.size) {
    let cur = '';
    let best = Infinity;
    for (const id of open) {
      const d = dist.get(id)!;
      if (d < best) { best = d; cur = id; }
    }
    open.delete(cur);
    if (cur === toId) break;
    done.add(cur);
    for (const edge of idx.adj.get(cur) ?? []) {
      if (opts.accessible && edge.type === 'stairs') continue;
      if (done.has(edge.to)) continue;
      const nd = best + edge.cost;
      if (nd < (dist.get(edge.to) ?? Infinity)) {
        dist.set(edge.to, nd);
        prev.set(edge.to, cur);
        open.add(edge.to);
      }
    }
  }
  if (!dist.has(toId)) return null;
  const nodes = [toId];
  while (nodes[0] !== fromId) nodes.unshift(prev.get(nodes[0])!);

  // Report walking distance only (exclude the floor-change penalty)
  let meters = 0;
  for (let i = 0; i < nodes.length - 1; i++) {
    const a = idx.nodeById.get(nodes[i])!;
    const c = idx.nodeById.get(nodes[i + 1])!;
    if (a.floor === c.floor) meters += Math.hypot(a.x - c.x, a.y - c.y) * idx.building.metersPerUnit;
  }
  return { nodes, distanceMeters: meters };
}

export function nodeLabel(n: GraphNode): string {
  if (n.name) return n.name;
  switch (n.kind) {
    case 'junction': return 'the intersection';
    case 'stairs': return 'the stairs';
    case 'elevator': return 'the elevator';
    default: return n.id;
  }
}

export function nearestNode(
  idx: BuildingIndex,
  floor: string,
  x: number,
  y: number,
): GraphNode | null {
  let best: GraphNode | null = null;
  let bd = Infinity;
  for (const n of idx.building.nodes) {
    if (n.floor !== floor) continue;
    const d = Math.hypot(n.x - x, n.y - y);
    if (d < bd) { bd = d; best = n; }
  }
  return best;
}

/** Closest point on any same-floor edge (floor-change edges ignored). */
export function snapToGraph(
  idx: BuildingIndex,
  floor: string,
  x: number,
  y: number,
): { x: number; y: number; distance: number } {
  let best = { x, y, distance: Infinity };
  for (const e of idx.building.edges) {
    const a = idx.nodeById.get(e.from)!;
    const c = idx.nodeById.get(e.to)!;
    if (a.floor !== floor || c.floor !== floor) continue;
    const dx = c.x - a.x;
    const dy = c.y - a.y;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / len2));
    const px = a.x + t * dx;
    const py = a.y + t * dy;
    const d = Math.hypot(x - px, y - py);
    if (d < best.distance) best = { x: px, y: py, distance: d };
  }
  return best;
}

/**
 * Expected compass heading of the nearest segment in an active route.
 * Returns null when the position is not close enough to that route.
 */
export function routeHeadingAt(
  idx: BuildingIndex,
  routeNodes: string[],
  floor: string,
  x: number,
  y: number,
  maxDistanceM = 3,
): number | null {
  let bestDistance = Infinity;
  let bestHeading: number | null = null;
  for (let i = 0; i < routeNodes.length - 1; i++) {
    const a = idx.nodeById.get(routeNodes[i]);
    const b = idx.nodeById.get(routeNodes[i + 1]);
    if (!a || !b || a.floor !== floor || b.floor !== floor) continue;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    if (len2 === 0) continue;
    const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / len2));
    const distance = Math.hypot(x - (a.x + t * dx), y - (a.y + t * dy));
    if (distance < bestDistance) {
      bestDistance = distance;
      const planHeading = (Math.atan2(dx, -dy) * 180) / Math.PI;
      bestHeading = ((planHeading + idx.building.northOffsetDeg) % 360 + 360) % 360;
    }
  }
  return bestDistance * idx.building.metersPerUnit <= maxDistanceM ? bestHeading : null;
}

/** Signed turn in degrees between two segments. Plan y points down, so positive = right turn. */
export function turnAngle(a: GraphNode, b: GraphNode, c: GraphNode): number {
  const h1 = Math.atan2(b.y - a.y, b.x - a.x);
  const h2 = Math.atan2(c.y - b.y, c.x - b.x);
  let d = ((h2 - h1) * 180) / Math.PI;
  while (d > 180) d -= 360;
  while (d <= -180) d += 360;
  return d;
}

export function describeRoute(idx: BuildingIndex, route: Route): DirectionStep[] {
  const { building, nodeById } = idx;
  const floorLabel = (id: string) => building.floors.find((f) => f.id === id)?.label ?? id;
  const path = route.nodes.map((id) => nodeById.get(id)!);
  if (path.length === 0) return [];
  if (path.length === 1) {
    return [{ text: `You are at ${nodeLabel(path[0])}`, distanceMeters: 0, nodeId: path[0].id }];
  }

  const steps: DirectionStep[] = [];
  let cur = { text: `Start at ${nodeLabel(path[0])}`, meters: 0, nodeId: path[0].id };
  const push = () => steps.push({ text: cur.text, distanceMeters: Math.round(cur.meters), nodeId: cur.nodeId });

  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i];
    const b = path[i + 1];

    if (a.floor !== b.floor) {
      const type = idx.adj.get(a.id)!.find((e) => e.to === b.id)!.type;
      push();
      steps.push({
        text: `${type === 'elevator' ? 'Take the elevator' : 'Take the stairs'} to ${floorLabel(b.floor)}`,
        distanceMeters: 0,
        nodeId: a.id,
      });
      cur = { text: `Continue from ${nodeLabel(b)}`, meters: 0, nodeId: b.id };
      continue;
    }

    cur.meters += Math.hypot(a.x - b.x, a.y - b.y) * building.metersPerUnit;

    const c = path[i + 2];
    if (c && c.floor === b.floor) {
      const turn = turnAngle(a, b, c);
      if (Math.abs(turn) >= 35) {
        push();
        const dir = Math.abs(turn) > 135 ? 'Turn around' : turn > 0 ? 'Turn right' : 'Turn left';
        cur = { text: `${dir} at ${nodeLabel(b)}`, meters: 0, nodeId: b.id };
      }
    }
  }
  push();
  const last = path[path.length - 1];
  steps.push({ text: `Arrive at ${nodeLabel(last)}`, distanceMeters: 0, nodeId: last.id });
  // drop empty "Continue from X" steps (e.g. destination is right after a floor change)
  return steps.filter((s) => !(s.text.startsWith('Continue from') && s.distanceMeters === 0));
}

export function destinations(building: Building): GraphNode[] {
  return building.nodes
    .filter((n) => n.kind !== 'junction' && n.name)
    .sort((a, b) => a.name!.localeCompare(b.name!, undefined, { numeric: true }));
}
