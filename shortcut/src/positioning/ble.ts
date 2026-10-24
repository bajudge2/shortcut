import { BleClient, type ScanResult } from '@capacitor-community/bluetooth-le';
import { BeaconTracker, parseBeaconName } from '../lib/beacon-math.ts';

export interface BeaconSnapshot { id: string; rssi: number; ageMs: number }

export interface BleHandlers {
  /** strongest stable beacon id, or null when nothing usable is in range (called ~1/s) */
  onBeacon: (beaconId: string | null) => void;
  /** live readings for the debug panel (called ~1/s) */
  onSnapshot?: (snapshot: BeaconSnapshot[]) => void;
}

/**
 * Scans for our ESP32 beacons (filtered by service UUID), smooths RSSI, and
 * reports which beacon is nearest. Needs a real iPhone: the iOS Simulator has no Bluetooth.
 */
export class BleLocator {
  private tracker = new BeaconTracker();
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(private serviceUuid: string, private namePrefix: string) {}

  get isRunning(): boolean { return this.running; }

  async start(handlers: BleHandlers): Promise<void> {
    if (this.running) return;
    await BleClient.initialize();
    this.tracker.reset();
    await BleClient.requestLEScan(
      { services: [this.serviceUuid], allowDuplicates: true },
      (result: ScanResult) => {
        const name = result.localName ?? result.device.name;
        const id = parseBeaconName(name, this.namePrefix);
        if (id && typeof result.rssi === 'number') this.tracker.update(id, result.rssi, Date.now());
      },
    );
    this.running = true;
    this.timer = setInterval(() => {
      const now = Date.now();
      handlers.onSnapshot?.(this.tracker.snapshot(now));
      handlers.onBeacon(this.tracker.best(now)?.id ?? null);
    }, 1000);
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.running) {
      try { await BleClient.stopLEScan(); } catch { /* ignore */ }
    }
    this.running = false;
    this.tracker.reset();
  }
}
