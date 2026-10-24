import { indexBuilding, nearestNode, routeHeadingAt, snapToGraph, type BuildingIndex } from '../lib/graph.ts';
import { WrongWayDetector } from '../lib/fusion-math.ts';
import { advanceStep, type StepObservation } from '../lib/pdr-math.ts';
import type { BeaconFix, Building, Position, PositionSource } from '../lib/types.ts';

const STORAGE_KEY = 'cnav:position';
const MAX_RESTORE_AGE_MS = 10 * 60 * 1000;
const SAME_BEACON_CORRECTION_MS = 8000;
const CLOSE_BEACON_RSSI = -68;
const MIN_CORRECTION_DISTANCE_M = 1.5;

export interface NavigationState {
  wrongWay: boolean;
  headingErrorDeg: number | null;
}

/** Single source of truth that fuses exact anchors, stable BLE fixes, and step PDR. */
export class PositionEngine {
  readonly idx: BuildingIndex;
  private pos: Position | null = null;
  private listeners = new Set<(p: Position | null) => void>();
  private navigationListeners = new Set<(state: NavigationState) => void>();
  private navigationState: NavigationState = { wrongWay: false, headingErrorDeg: null };
  private wrongWay = new WrongWayDetector();
  private activeRoute: string[] = [];
  private activeRouteKey = '';
  private lastBeaconId: string | null = null;
  private lastBeaconFixAt = 0;

  constructor(private building: Building, private stepLengthM: number) {
    this.idx = indexBuilding(building);
    this.restore();
  }

  get position(): Position | null { return this.pos; }
  get navigation(): NavigationState { return this.navigationState; }

  subscribe(fn: (p: Position | null) => void): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  subscribeNavigation(fn: (state: NavigationState) => void): () => void {
    this.navigationListeners.add(fn);
    return () => { this.navigationListeners.delete(fn); };
  }

  /** Supplies the currently displayed route so step headings can detect sustained wrong-way travel. */
  setRoute(nodes: string[]): void {
    const key = nodes.join('>');
    if (key === this.activeRouteKey) return;
    this.activeRoute = [...nodes];
    this.activeRouteKey = key;
    this.resetWrongWay();
  }

  /** Exact fix on a graph node. Returns false if the node id is unknown. */
  setAnchor(nodeId: string, source: PositionSource): boolean {
    const n = this.idx.nodeById.get(nodeId);
    if (!n) return false;
    this.set({ floor: n.floor, x: n.x, y: n.y, nodeId: n.id, source, timestamp: Date.now() }, true);
    this.resetWrongWay();
    return true;
  }

  /** Debug / demo helper: teleport to an arbitrary point (snapped to the nearest corridor). */
  setPoint(floor: string, x: number, y: number): void {
    const s = snapToGraph(this.idx, floor, x, y);
    if (!isFinite(s.distance)) return;
    this.set({ floor, x: s.x, y: s.y, source: 'sim', timestamp: Date.now() }, true);
    this.resetWrongWay();
  }

  /** Called once/s with the stable, averaged nearest beacon (or null). */
  onBeacon(beacon: BeaconFix | null): void {
    if (beacon === null) return; // keep identity so a brief dropout cannot bypass correction gates
    const def = this.building.beacons.find((candidate) => candidate.id === beacon.id);
    if (!def) return;

    const now = Date.now();
    const node = this.idx.nodeById.get(def.node);
    if (!node) return;
    const distanceM = this.pos && this.pos.floor === node.floor
      ? Math.hypot(this.pos.x - node.x, this.pos.y - node.y) * this.building.metersPerUnit
      : Infinity;
    const changedBeacon = beacon.id !== this.lastBeaconId;
    const confidentReturn = beacon.rssi >= CLOSE_BEACON_RSSI
      && distanceM >= MIN_CORRECTION_DISTANCE_M
      && now - this.lastBeaconFixAt >= SAME_BEACON_CORRECTION_MS;

    // First/new stable beacon is an exact fix. The same beacon may correct accumulated
    // PDR drift only when very close and after a cooldown, preventing repeated jumps.
    if (!this.pos || changedBeacon || confidentReturn) {
      this.lastBeaconId = beacon.id;
      this.lastBeaconFixAt = now;
      this.setAnchor(def.node, 'ble');
    }
  }

  /** Called per accelerometer-confirmed step with compass+gyro fused heading. */
  onStep(observation: StepObservation): void {
    if (!this.pos) return;
    const expected = routeHeadingAt(
      this.idx,
      this.activeRoute,
      this.pos.floor,
      this.pos.x,
      this.pos.y,
    );
    const nextNavigation = this.wrongWay.push(observation.headingDeg, expected);
    if (nextNavigation.wrongWay !== this.navigationState.wrongWay
      || nextNavigation.headingErrorDeg !== this.navigationState.headingErrorDeg) {
      this.navigationState = nextNavigation;
      this.emitNavigation();
    }
    this.set(advanceStep(this.idx, this.pos, observation.headingDeg, this.stepLengthM, observation.timestamp), false);
  }

  clear(): void {
    this.pos = null;
    this.lastBeaconId = null;
    this.lastBeaconFixAt = 0;
    this.resetWrongWay();
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
    this.emit();
  }

  nearestNodeId(): string | null {
    if (!this.pos) return null;
    return this.pos.nodeId ?? nearestNode(this.idx, this.pos.floor, this.pos.x, this.pos.y)?.id ?? null;
  }

  private set(p: Position, persist: boolean): void {
    this.pos = p;
    if (persist) {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(p)); } catch { /* ignore */ }
    }
    this.emit();
  }

  private resetWrongWay(): void {
    this.wrongWay.reset();
    if (this.navigationState.wrongWay || this.navigationState.headingErrorDeg !== null) {
      this.navigationState = { wrongWay: false, headingErrorDeg: null };
      this.emitNavigation();
    }
  }

  private emit(): void { for (const listener of this.listeners) listener(this.pos); }
  private emitNavigation(): void { for (const listener of this.navigationListeners) listener(this.navigationState); }

  private restore(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const p = JSON.parse(raw) as Position;
      if (Date.now() - p.timestamp > MAX_RESTORE_AGE_MS) return;
      if (p.nodeId && !this.idx.nodeById.has(p.nodeId)) return;
      this.pos = p;
    } catch { /* ignore corrupt/unavailable storage */ }
  }
}
