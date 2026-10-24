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
  switchConfirmations: number; // consecutive ~1 s decisions required before switching
}

export const DEFAULT_BEACON_OPTS: BeaconTrackerOptions = {
  alpha: 0.3,
  staleMs: 4000,
  // Only anchor to a beacon when it's close. With the firmware's defaults (+3 dBm TX,
  // about -59 dBm at 1 m) indoors, -78 dBm is roughly 5 m; -90 would snap the dot to a
  // beacon 20+ m away. Re-tune on a real walk (watch Debug RSSI next to each beacon).
  minRssi: -78,
  hysteresisDb: 5,
  switchConfirmations: 2,
};

interface Reading { ema: number; lastSeen: number }

export class BeaconTracker {
  private readings = new Map<string, Reading>();
  private currentId: string | null = null;
  private challengerId: string | null = null;
  private challengerCount = 0;
  private challengerSeenAt = -1;
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
    if (live.length === 0) { this.currentId = null; this.clearChallenger(); return null; }
    const top = live[0];
    const cur = this.currentId ? live.find((r) => r.id === this.currentId) : undefined;
    if (!cur) {
      this.currentId = top.id;
      this.clearChallenger();
      return { id: top.id, rssi: top.rssi };
    }
    if (top.id === cur.id || top.rssi <= cur.rssi + this.opts.hysteresisDb) {
      this.clearChallenger();
      return { id: cur.id, rssi: cur.rssi };
    }
    const challengerSeenAt = now - top.ageMs;
    if (this.challengerId !== top.id) {
      this.challengerId = top.id;
      this.challengerCount = 1;
      this.challengerSeenAt = challengerSeenAt;
    } else if (challengerSeenAt !== this.challengerSeenAt) {
      // Only a fresh one-second RSSI batch counts as another confirmation.
      this.challengerCount++;
      this.challengerSeenAt = challengerSeenAt;
    }
    if (this.challengerCount >= this.opts.switchConfirmations) {
      this.currentId = top.id;
      this.clearChallenger();
      return { id: top.id, rssi: top.rssi };
    }
    return { id: cur.id, rssi: cur.rssi };
  }

  reset(): void { this.readings.clear(); this.currentId = null; this.clearChallenger(); }

  private clearChallenger(): void {
    this.challengerId = null;
    this.challengerCount = 0;
    this.challengerSeenAt = -1;
  }
}

/** Mean RSSI with one low/high outlier removed when a one-second batch has enough packets. */
export function averageRssiBatch(values: number[]): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const used = sorted.length >= 5 ? sorted.slice(1, -1) : sorted;
  return used.reduce((sum, value) => sum + value, 0) / used.length;
}

/** Extracts the short beacon id from an advertised name like "CNAV-B1". */
export function parseBeaconName(name: string | undefined | null, prefix: string): string | null {
  if (!name || !name.startsWith(prefix)) return null;
  const id = name.slice(prefix.length).trim();
  return id || null;
}
