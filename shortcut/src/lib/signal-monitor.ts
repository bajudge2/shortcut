import { SIGNAL_QUIET_THRESHOLD_MS } from '../config.ts';

/**
 * Signal-lost detection (Requirement 1).
 *
 * Pure logic: every input carries a caller-supplied integer millisecond timestamp.
 * Nothing here reads clocks, timers, Bluetooth, or the page.
 */

export type SignalInput =
  | { kind: 'scanning'; on: boolean; t: number }
  | { kind: 'beacon'; id: string | null; t: number }
  | { kind: 'manualAnchor'; t: number }
  | { kind: 'dismiss'; t: number };

export interface SignalState {
  scanning: boolean;
  /** start of the current Quiet_Period, or null when none is in progress */
  quietStart: number | null;
  /** set by a Manual_Anchor or dismissal; cleared by a non-null report or scanning off */
  suppressed: boolean;
  /** latest accepted timestamp (inputs and queries); -Infinity initially */
  lastT: number;
}

export const INITIAL_SIGNAL_STATE: SignalState = Object.freeze({
  scanning: false,
  quietStart: null,
  suppressed: false,
  lastT: -Infinity,
}) as SignalState;

/** A timestamp is accepted only if it is an integer and not earlier than lastT (Req 1.12). */
function accepts(s: SignalState, t: number): boolean {
  return Number.isInteger(t) && t >= s.lastT;
}

/** Pure transition. Returns the same object when the input is ignored. */
export function applySignalInput(s: SignalState, input: SignalInput): SignalState {
  const { t } = input;
  if (!accepts(s, t)) return s;

  if (input.kind === 'scanning') {
    if (input.on) {
      // Turn-on while off starts a new Quiet_Period; while on, only lastT moves (1.5).
      if (!s.scanning) return { scanning: true, quietStart: t, suppressed: false, lastT: t };
      return { ...s, lastT: t };
    }
    // Turn-off discards the Quiet_Period and suppression (1.11).
    if (s.scanning) return { scanning: false, quietStart: null, suppressed: false, lastT: t };
    return { ...s, lastT: t };
  }

  // Every other input is ignored entirely while scanning is off, including lastT (1.4).
  if (!s.scanning) return s;

  switch (input.kind) {
    case 'beacon':
      if (input.id !== null) {
        // A usable beacon ends the Quiet_Period and clears suppression (1.6).
        return { ...s, quietStart: null, suppressed: false, lastT: t };
      }
      // First null report starts a Quiet_Period; later ones never move it (1.7).
      return { ...s, quietStart: s.quietStart ?? t, lastT: t };
    case 'manualAnchor': // 1.9
    case 'dismiss': // 1.10
      return { ...s, suppressed: true, lastT: t };
  }
}

/** Pure query. `state` is s with lastT advanced (unchanged when t < s.lastT). */
export function querySignal(
  s: SignalState,
  t: number,
  thresholdMs: number,
): { state: SignalState; lost: boolean; quietMs: number } {
  const ok = accepts(s, t);
  // An earlier (or malformed) query is answered as of the latest accepted timestamp.
  const at = ok ? t : s.lastT;
  const state = ok && t !== s.lastT ? { ...s, lastT: t } : s;
  const inQuiet = s.scanning && s.quietStart !== null;
  const quietMs = inQuiet ? at - (s.quietStart as number) : 0;
  const lost = inQuiet && !s.suppressed && quietMs >= thresholdMs;
  return { state, lost, quietMs };
}

/** Stateful wrapper around the pure reducer and query. */
export class SignalMonitor {
  private readonly thresholdMs: number;
  private current: SignalState = INITIAL_SIGNAL_STATE;

  constructor(thresholdMs: number = SIGNAL_QUIET_THRESHOLD_MS) {
    if (!Number.isFinite(thresholdMs) || thresholdMs <= 0) {
      throw new RangeError(`thresholdMs must be a finite number > 0, got ${thresholdMs}`);
    }
    this.thresholdMs = thresholdMs;
  }

  get state(): SignalState {
    return this.current;
  }

  setScanning(on: boolean, t: number): void {
    this.current = applySignalInput(this.current, { kind: 'scanning', on, t });
  }

  report(beaconId: string | null, t: number): void {
    this.current = applySignalInput(this.current, { kind: 'beacon', id: beaconId, t });
  }

  manualAnchor(t: number): void {
    this.current = applySignalInput(this.current, { kind: 'manualAnchor', t });
  }

  dismiss(t: number): void {
    this.current = applySignalInput(this.current, { kind: 'dismiss', t });
  }

  isLost(t: number): boolean {
    const r = querySignal(this.current, t, this.thresholdMs);
    this.current = r.state;
    return r.lost;
  }

  quietMs(t: number): number {
    const r = querySignal(this.current, t, this.thresholdMs);
    this.current = r.state;
    return r.quietMs;
  }
}
