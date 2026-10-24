import { BleClient, type ScanResult } from '@capacitor-community/bluetooth-le';
import { BeaconTracker, averageRssiBatch, parseBeaconName } from '../lib/beacon-math.ts';

import type { BeaconFix } from '../lib/types.ts';

export interface BeaconSnapshot { id: string; rssi: number; ageMs: number }

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
 */
export class BleLocator {
  private tracker = new BeaconTracker();
  private pending = new Map<string, number[]>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(private serviceUuid: string, private namePrefix: string) {}

  get isRunning(): boolean { return this.running; }

  async start(handlers: BleHandlers): Promise<void> {
    if (this.running) return;
    await BleClient.initialize();
    this.tracker.reset();
    this.pending.clear();
    await BleClient.requestLEScan(
      { services: [this.serviceUuid], allowDuplicates: true },
      (result: ScanResult) => {
        const name = result.localName ?? result.device.name;
        const id = parseBeaconName(name, this.namePrefix);
        if (!id || typeof result.rssi !== 'number') return;
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
        if (Number.isFinite(average)) this.tracker.update(id, average, now);
      }
      this.pending.clear();
      const snapshot = this.tracker.snapshot(now);
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
    this.tracker.reset();
  }
}
