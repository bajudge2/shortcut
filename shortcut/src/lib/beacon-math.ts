/**
 * Turns noisy BLE RSSI readings into a stable "nearest beacon" decision.
 *  - exponential moving average per beacon
 *  - ignore beacons that are stale or too weak
 *  - hysteresis: only switch to a new beacon if it is clearly stronger
 */
export interface BeaconTrackerOptions {
  alpha: number;        // EMA smoothing factor (0..1, higher = more reactive)
  staleMs: number;      // drop a beacon not heard for this long
  minRssi: number;      // ignore anything weaker than this (dBm)
  hysteresisDb: number; // challenger must beat current by this much
}

export const DEFAULT_BEACON_OPTS: BeaconTrackerOptions = {
  alpha: 0.3,
  staleMs: 4000,
  minRssi: -90,
  hysteresisDb: 5,
};

interface Reading { ema: number; lastSeen: number }

export class BeaconTracker {
  private readings = new Map<string, Reading>();
  private currentId: string | null = null;
  constructor(private opts: BeaconTrackerOptions = DEFAULT_BEACON_OPTS) {}

  update(id: string, rssi: number, now: number): void {
    const r = this.readings.get(id);
    if (!r) this.readings.set(id, { ema: rssi, lastSeen: now });
    else {
      r.ema = this.opts.alpha * rssi + (1 - this.opts.alpha) * r.ema;
      r.lastSeen = now;
    }
  }

  /** Snapshot of live beacons for debugging, strongest first. */
  snapshot(now: number): { id: string; rssi: number; ageMs: number }[] {
    return [...this.readings.entries()]
      .map(([id, r]) => ({ id, rssi: r.ema, ageMs: now - r.lastSeen }))
      .filter((r) => r.ageMs <= this.opts.staleMs)
      .sort((a, b) => b.rssi - a.rssi);
  }

  best(now: number): { id: string; rssi: number } | null {
    const live = this.snapshot(now).filter((r) => r.rssi >= this.opts.minRssi);
    if (live.length === 0) { this.currentId = null; return null; }
    const top = live[0];
    const cur = this.currentId ? live.find((r) => r.id === this.currentId) : undefined;
    if (!cur || top.id === cur.id || top.rssi > cur.rssi + this.opts.hysteresisDb) {
      this.currentId = top.id;
      return { id: top.id, rssi: top.rssi };
    }
    return { id: cur.id, rssi: cur.rssi };
  }

  reset(): void { this.readings.clear(); this.currentId = null; }
}

/** Extracts the short beacon id from an advertised name like "CNAV-B1". */
export function parseBeaconName(name: string | undefined | null, prefix: string): string | null {
  if (!name || !name.startsWith(prefix)) return null;
  const id = name.slice(prefix.length).trim();
  return id || null;
}
