import { useCallback, useEffect, useRef, useState } from 'react';
import { SignalMonitor } from '../lib/signal-monitor.ts';
import type { PositionEngine } from '../positioning/engine.ts';
import type { BeaconFix } from '../lib/types.ts';

/** RSSI used for simulated beacon taps: strong enough to count as standing next to the beacon. */
const SIM_BEACON_RSSI = -55;

/** Simulated "no beacon" cadence; matches BleLocator's 1 s report rate. */
const SIM_TICK_MS = 1000;
/** Display refresh while scanning; keeps banner/Debug updates within 1 s (Req 2.1, 2.8, 4.6). */
const REFRESH_TICK_MS = 250;

export interface SignalMonitorApi {
  lost: boolean;
  /** Math.floor(quietMs / 1000) */
  quietSeconds: number;
  simOn: boolean;
  /** true while real BLE is on (Req 4.8) */
  simDisabled: boolean;
  /** no-op while simDisabled */
  setSimOn(on: boolean): void;
  /** stable identity; real BLE path */
  reportBeacon(beacon: BeaconFix | null): void;
  /** Debug beacon buttons */
  simulateBeacon(id: string): void;
  notifyManualAnchor(): void;
  dismiss(): void;
}

const now = (): number => Math.floor(performance.now());

interface Display {
  lost: boolean;
  quietSeconds: number;
}

export function useSignalMonitor(opts: { engine: PositionEngine; realBleOn: boolean }): SignalMonitorApi {
  const { engine, realBleOn } = opts;

  const monitorRef = useRef<SignalMonitor | null>(null);
  if (monitorRef.current === null) monitorRef.current = new SignalMonitor();

  // Latest values read by stable callbacks so callers never hold a stale closure.
  const engineRef = useRef(engine);
  engineRef.current = engine;
  const realBleOnRef = useRef(realBleOn);
  realBleOnRef.current = realBleOn;

  const [display, setDisplay] = useState<Display>({ lost: false, quietSeconds: 0 });
  const [simOn, setSimOnState] = useState(false);

  const refresh = useCallback(() => {
    const m = monitorRef.current as SignalMonitor;
    const t = now();
    const lost = m.isLost(t);
    const quietSeconds = Math.floor(m.quietMs(t) / 1000);
    // Return the previous object when nothing displayed changed, so React skips the render.
    setDisplay((prev) =>
      prev.lost === lost && prev.quietSeconds === quietSeconds ? prev : { lost, quietSeconds },
    );
  }, []);

  // Same path for real and simulated reports (Req 4.10).
  const reportBeacon = useCallback(
    (beacon: BeaconFix | null) => {
      (monitorRef.current as SignalMonitor).report(beacon?.id ?? null, now());
      engineRef.current.onBeacon(beacon);
      refresh();
    },
    [refresh],
  );

  const simulateBeacon = useCallback((id: string) => reportBeacon({ id, rssi: SIM_BEACON_RSSI }), [reportBeacon]);

  const setSimOn = useCallback((on: boolean) => {
    if (realBleOnRef.current) return; // disabled while real BLE is on (Req 4.8)
    setSimOnState(on);
  }, []);

  const notifyManualAnchor = useCallback(() => {
    (monitorRef.current as SignalMonitor).manualAnchor(now());
    refresh(); // hide the banner in the same render (Req 2.5)
  }, [refresh]);

  const dismiss = useCallback(() => {
    (monitorRef.current as SignalMonitor).dismiss(now());
    refresh(); // Req 2.7
  }, [refresh]);

  const scanning = realBleOn || simOn;

  // Scanning on/off (Req 4.2, 4.7, 2.8).
  useEffect(() => {
    (monitorRef.current as SignalMonitor).setScanning(scanning, now());
    refresh();
  }, [scanning, refresh]);

  // Simulated "no beacon in range" reports while simulation is on (Req 4.3, 4.7).
  useEffect(() => {
    if (!simOn) return;
    const id = setInterval(() => reportBeacon(null), SIM_TICK_MS);
    return () => clearInterval(id);
  }, [simOn, reportBeacon]);

  // Real BLE takes over from simulation (Req 4.9).
  useEffect(() => {
    if (realBleOn) setSimOnState(false);
  }, [realBleOn]);

  // Periodic display refresh while scanning (Req 2.1, 2.8, 4.6).
  useEffect(() => {
    if (!scanning) return;
    const id = setInterval(refresh, REFRESH_TICK_MS);
    return () => clearInterval(id);
  }, [scanning, refresh]);

  return {
    lost: display.lost,
    quietSeconds: display.quietSeconds,
    simOn,
    simDisabled: realBleOn,
    setSimOn,
    reportBeacon,
    simulateBeacon,
    notifyManualAnchor,
    dismiss,
  };
}
