import { indexBuilding, nearestNode, routeHeadingAt, snapToGraph, type BuildingIndex } from '../lib/graph.ts';
import { WrongWayDetector } from '../lib/fusion-math.ts';
import { advanceStep, type StepObservation } from '../lib/pdr-math.ts';
import type { BeaconFix, Building, Position, PositionSource } from '../lib/types.ts';

const STORAGE_KEY = 'cnav:position';
const MAX_RESTORE_AGE_MS = 10 * 60 * 1000;
const SAME_BEACON_CORRECTION_MS = 8000;
const CLOSE_BEACON_RSSI = -68;
const MIN_CORRECTION_DISTANCE_M = 1.5;
/** A beacon is usable from about this far away (minRssi -78 dBm ≈ 5 m) plus margin. */
const BEACON_RANGE_M = 6;
/** Dead-reckoning error grows with distance walked since the last exact fix. */
const PDR_DRIFT_FRACTION = 0.3;
/** Consecutive ~1 s reports needed to accept a beacon dead reckoning says is too far away. */
const IMPLAUSIBLE_BEACON_CONFIRMATIONS = 6;

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
  /** meters walked (by step count) since the last exact fix */
  private walkedSinceFixM = 0;
  /** false until this session has an exact fix; a restored position is not trusted for gating */
  private hasSessionFix = false;
  private pendingBeaconId: string | null = null;
  private pendingBeaconCount = 0;

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
    this.markExactFix();
    this.resetWrongWay();
    return true;
  }

  /** Debug / demo helper: teleport to an arbitrary point (snapped to the nearest corridor). */
  setPoint(floor: string, x: number, y: number): void {
    const s = snapToGraph(this.idx, floor, x, y);
    if (!isFinite(s.distance)) return;
    this.set({ floor, x: s.x, y: s.y, source: 'sim', timestamp: Date.now() }, true);
    this.markExactFix();
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
    // No trusted estimate yet (first fix, or only a restored position): accept.
    if (!this.pos || !this.hasSessionFix) { this.acceptBeacon(beacon.id, def.node, now); return; }

    // Same beacon: only correct accumulated drift when very close and after a cooldown.
    if (beacon.id === this.lastBeaconId) {
      this.clearPendingBeacon();
      const confidentReturn = beacon.rssi >= CLOSE_BEACON_RSSI
        && distanceM >= MIN_CORRECTION_DISTANCE_M
        && now - this.lastBeaconFixAt >= SAME_BEACON_CORRECTION_MS;
      if (confidentReturn) this.acceptBeacon(beacon.id, def.node, now);
      return;
    }

    // Different beacon: accept only if dead reckoning says we could plausibly be near it.
    // Otherwise (e.g. the destination beacon dropped out and a far one got loudest) hold
    // the step-based position, unless the far beacon persists long enough to prove we're lost.
    const allowanceM = BEACON_RANGE_M + PDR_DRIFT_FRACTION * this.walkedSinceFixM;
    if (distanceM <= allowanceM) { this.acceptBeacon(beacon.id, def.node, now); return; }
    if (this.pendingBeaconId === beacon.id) this.pendingBeaconCount++;
    else { this.pendingBeaconId = beacon.id; this.pendingBeaconCount = 1; }
    if (this.pendingBeaconCount >= IMPLAUSIBLE_BEACON_CONFIRMATIONS) this.acceptBeacon(beacon.id, def.node, now);
  }

  /** Beacon fix that dead reckoning rejected and is still waiting on (for the debug panel). */
  get pendingBeacon(): { id: string; count: number; needed: number } | null {
    return this.pendingBeaconId
      ? { id: this.pendingBeaconId, count: this.pendingBeaconCount, needed: IMPLAUSIBLE_BEACON_CONFIRMATIONS }
      : null;
  }

  private acceptBeacon(id: string, nodeId: string, now: number): void {
    this.lastBeaconId = id;
    this.lastBeaconFixAt = now;
    this.clearPendingBeacon();
    this.setAnchor(nodeId, 'ble');
  }

  private clearPendingBeacon(): void {
    this.pendingBeaconId = null;
    this.pendingBeaconCount = 0;
  }

  private markExactFix(): void {
    this.walkedSinceFixM = 0;
    this.hasSessionFix = true;
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
    this.walkedSinceFixM += this.stepLengthM;
  }

  clear(): void {
    this.pos = null;
    this.lastBeaconId = null;
    this.lastBeaconFixAt = 0;
    this.walkedSinceFixM = 0;
    this.hasSessionFix = false;
    this.clearPendingBeacon();
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
      // a position saved on a floor the map no longer has (e.g. after a map swap) would blank the map
      if (!this.building.floors.some((f) => f.id === p.floor)) return;
      this.pos = p;
    } catch { /* ignore corrupt/unavailable storage */ }
  }
}
