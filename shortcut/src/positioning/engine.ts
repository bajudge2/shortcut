import { indexBuilding, nearestNode, snapToGraph, type BuildingIndex } from '../lib/graph.ts';
import { advanceStep } from '../lib/pdr-math.ts';
import type { Building, Position, PositionSource } from '../lib/types.ts';

const STORAGE_KEY = 'cnav:position';
const MAX_RESTORE_AGE_MS = 10 * 60 * 1000;

/**
 * Single source of truth for "where is the user".
 *
 *  - Anchors (QR scan, BLE beacon, manual tap) set an exact node position.
 *  - Steps (dead reckoning) move the dot between anchors, snapped to corridors.
 *
 * Every positioning source just calls one of the methods below, so adding a
 * new source (NFC, Wi-Fi, ...) never touches the UI.
 */
export class PositionEngine {
  readonly idx: BuildingIndex;
  private pos: Position | null = null;
  private listeners = new Set<(p: Position | null) => void>();
  private lastBeaconId: string | null = null;

  constructor(private building: Building, private stepLengthM: number) {
    this.idx = indexBuilding(building);
    this.restore();
  }

  get position(): Position | null { return this.pos; }

  subscribe(fn: (p: Position | null) => void): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  /** Exact fix on a graph node. Returns false if the node id is unknown. */
  setAnchor(nodeId: string, source: PositionSource): boolean {
    const n = this.idx.nodeById.get(nodeId);
    if (!n) return false;
    this.set({ floor: n.floor, x: n.x, y: n.y, nodeId: n.id, source, timestamp: Date.now() }, true);
    return true;
  }

  /** Debug / demo helper: teleport to an arbitrary point (snapped to the nearest corridor). */
  setPoint(floor: string, x: number, y: number): void {
    const s = snapToGraph(this.idx, floor, x, y);
    if (!isFinite(s.distance)) return;
    this.set({ floor, x: s.x, y: s.y, source: 'sim', timestamp: Date.now() }, true);
  }

  /** Called ~1/s with the currently-nearest beacon id (or null if none in range). */
  onBeacon(beaconId: string | null): void {
    if (beaconId === null) { this.lastBeaconId = null; return; }
    if (beaconId === this.lastBeaconId) return; // same beacon: let dead reckoning move the dot
    const def = this.building.beacons.find((b) => b.id === beaconId);
    if (!def) return; // unknown beacon: ignore (shows up in the debug panel)
    this.lastBeaconId = beaconId;
    this.setAnchor(def.node, 'ble');
  }

  /** Called per detected step with a compass heading in degrees (0 = north). */
  onStep(headingDeg: number): void {
    if (!this.pos) return;
    this.set(advanceStep(this.idx, this.pos, headingDeg, this.stepLengthM, Date.now()), false);
  }

  clear(): void {
    this.pos = null;
    this.lastBeaconId = null;
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
    this.emit();
  }

  /** Name of the node closest to the current position (for "You are near ..."). */
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

  private emit(): void { for (const l of this.listeners) l(this.pos); }

  private restore(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const p = JSON.parse(raw) as Position;
      if (Date.now() - p.timestamp > MAX_RESTORE_AGE_MS) return;
      if (p.nodeId && !this.idx.nodeById.has(p.nodeId)) return;
      this.pos = p;
    } catch { /* ignore corrupt storage */ }
  }
}
