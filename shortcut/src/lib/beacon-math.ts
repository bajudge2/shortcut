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
    // Keep currentId through silence: a beacon that briefly drops out of range must not
    // hand its place to whatever is heard next without the normal confirmation.
    if (live.length === 0) { this.clearChallenger(); return null; }
    const top = live[0];
    if (this.currentId === null) {
      this.currentId = top.id; // very first fix (or after reset) is accepted immediately
      this.clearChallenger();
      return { id: top.id, rssi: top.rssi };
    }
    const cur = live.find((r) => r.id === this.currentId);
    if (cur && (top.id === cur.id || top.rssi <= cur.rssi + this.opts.hysteresisDb)) {
      this.clearChallenger();
      return { id: cur.id, rssi: cur.rssi };
    }
    // Here the challenger is either clearly stronger, or the current beacon is briefly
    // out of range. Both cases need fresh, consecutive confirmations to switch.
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
    // Unconfirmed challenger: hold the current beacon if heard, otherwise report nothing.
    return cur ? { id: cur.id, rssi: cur.rssi } : null;
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

/**
 * The 1 m RSSI every threshold in this file and engine.ts was tuned for (the firmware's
 * default `measuredPower`). Calibrated readings are expressed relative to this reference.
 */
export const REFERENCE_MEASURED_POWER = -59;

/** Manufacturer data format version written by the firmware (protocol.h kMfgFormatVersion). */
const CALIBRATION_FORMAT_VERSION = 1;

export interface BeaconCalibration {
  /** expected RSSI at 1 m in dBm, as calibrated on the board */
  measuredPower: number;
  /** path-loss exponent (2.0 = free space); broadcast by the firmware, not used for ranking */
  pathLoss: number;
  /** low byte of the board's config revision */
  rev: number;
}

/**
 * Parses the calibration payload from the beacon's scan response: manufacturer data for
 * company 0xFFFF with the 2-byte company id already removed, i.e.
 * [version, measuredPower (int8), pathLoss * 10 (uint8), rev (uint8)].
 * Returns null for an unknown version or values outside the firmware's validated ranges.
 */
export function parseBeaconCalibration(bytes: ArrayLike<number>): BeaconCalibration | null {
  if (bytes.length < 4 || bytes[0] !== CALIBRATION_FORMAT_VERSION) return null;
  const measuredPower = bytes[1] > 127 ? bytes[1] - 256 : bytes[1];
  const pathLossX10 = bytes[2];
  if (measuredPower < -120 || measuredPower > 0) return null;
  if (pathLossX10 < 10 || pathLossX10 > 60) return null;
  return { measuredPower, pathLoss: pathLossX10 / 10, rev: bytes[3] };
}

/**
 * Removes per-board differences (TX power, antenna, chip) before beacons are compared:
 * a board calibrated hotter than the reference is turned down by the difference, so
 * "strongest beacon" means "closest beacon", not "loudest board". Without a calibration
 * the reading is returned unchanged.
 */
export function calibrateRssi(rssi: number, measuredPower?: number | null): number {
  if (measuredPower === undefined || measuredPower === null) return rssi;
  return rssi - (measuredPower - REFERENCE_MEASURED_POWER);
}

/** Extracts the short beacon id from an advertised name like "CNAV-B1". */
export function parseBeaconName(name: string | undefined | null, prefix: string): string | null {
  if (!name || !name.startsWith(prefix)) return null;
  const id = name.slice(prefix.length).trim();
  return id || null;
}
