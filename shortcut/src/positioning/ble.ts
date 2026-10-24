import { BleClient, type ScanResult } from '@capacitor-community/bluetooth-le';
import {
  BeaconTracker,
  REFERENCE_MEASURED_POWER,
  averageRssiBatch,
  calibrateRssi,
  parseBeaconCalibration,
  parseBeaconName,
  type BeaconCalibration,
} from '../lib/beacon-math.ts';
import { BEACON_MFG_COMPANY_ID } from '../config.ts';

import type { BeaconFix } from '../lib/types.ts';

/** How long to wait for a board's scan-response calibration before ranking it uncalibrated. */
const CALIBRATION_GRACE_MS = 3000;

export interface BeaconSnapshot {
  id: string;
  /** calibrated, smoothed RSSI (dBm relative to the reference board); what beacons are ranked by */
  rssi: number;
  /** the same smoothed reading before calibration, as the phone actually hears it */
  rawRssi: number;
  /** the board's broadcast 1 m RSSI, or null if its scan response hasn't been received yet */
  measuredPower: number | null;
  ageMs: number;
}

export interface BleHandlers {
  /** strongest stable beacon, or null when nothing usable is in range (called once/s) */
  onBeacon: (beacon: BeaconFix | null) => void;
  /** live one-second-averaged readings for the debug panel */
  onSnapshot?: (snapshot: BeaconSnapshot[]) => void;
}

/**
 * Device-only BLE adapter. Raw duplicate advertisements are collected into one-second
 * batches before entering the slower EMA/hysteresis tracker. This prevents a split-second
 * multipath spike—or one beacon producing more packets—from immediately moving the dot.
 *
 * Each batch is calibrated with the board's own 1 m RSSI (from its scan response) before
 * ranking, so a board that simply transmits louder doesn't win from farther away.
 */
export class BleLocator {
  private tracker = new BeaconTracker();
  private pending = new Map<string, number[]>();
  private calibration = new Map<string, BeaconCalibration>();
  private firstHeardAt = new Map<string, number>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(private serviceUuid: string, private namePrefix: string) {}

  get isRunning(): boolean { return this.running; }

  async start(handlers: BleHandlers): Promise<void> {
    if (this.running) return;
    await BleClient.initialize();
    this.tracker.reset();
    this.pending.clear();
    this.calibration.clear();
    this.firstHeardAt.clear();
    await BleClient.requestLEScan(
      { services: [this.serviceUuid], allowDuplicates: true },
      (result: ScanResult) => {
        const name = result.localName ?? result.device.name;
        const id = parseBeaconName(name, this.namePrefix);
        if (!id || typeof result.rssi !== 'number') return;
        // Calibration rides in the scan response, so only some results carry it; keep the latest.
        const mfg = result.manufacturerData?.[String(BEACON_MFG_COMPANY_ID)];
        if (mfg) {
          const cal = parseBeaconCalibration(new Uint8Array(mfg.buffer, mfg.byteOffset, mfg.byteLength));
          if (cal) this.calibration.set(id, cal);
        }
        const batch = this.pending.get(id) ?? [];
        // Cap memory if a platform reports advertisements unusually quickly.
        if (batch.length < 100) batch.push(result.rssi);
        this.pending.set(id, batch);
      },
    );
    this.running = true;
    this.timer = setInterval(() => {
      const now = Date.now();
      for (const [id, samples] of this.pending) {
        const average = averageRssiBatch(samples);
        if (!Number.isFinite(average)) continue;
        if (!this.firstHeardAt.has(id)) this.firstHeardAt.set(id, now);
        const cal = this.calibration.get(id);
        // Don't rank a board before its calibration arrives (it could be a loud board winning the
        // immediately-accepted first fix). Boards that never send one are used raw after a grace period.
        if (!cal && now - this.firstHeardAt.get(id)! < CALIBRATION_GRACE_MS) continue;
        this.tracker.update(id, calibrateRssi(average, cal?.measuredPower), now);
      }
      this.pending.clear();
      const snapshot = this.tracker.snapshot(now).map((reading): BeaconSnapshot => {
        const measuredPower = this.calibration.get(reading.id)?.measuredPower ?? null;
        // Calibration is a constant offset, so adding it back recovers the raw smoothed value.
        const rawRssi = measuredPower === null ? reading.rssi : reading.rssi + (measuredPower - REFERENCE_MEASURED_POWER);
        return { ...reading, rawRssi, measuredPower };
      });
      handlers.onSnapshot?.(snapshot);
      const best = this.tracker.best(now);
      handlers.onBeacon(best ? { id: best.id, rssi: best.rssi } : null);
    }, 1000);
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.running) {
      try { await BleClient.stopLEScan(); } catch { /* ignore */ }
    }
    this.running = false;
    this.pending.clear();
    this.calibration.clear();
    this.firstHeardAt.clear();
    this.tracker.reset();
  }
}
