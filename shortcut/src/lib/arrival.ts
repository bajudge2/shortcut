import { ARRIVAL_DWELL_MS } from '../config.ts';

/**
 * Arrival dwell state machine (Requirement 6).
 *
 * The card shows as soon as the route start equals the destination, survives
 * position drift shorter than `dwellMs`, and hides immediately on a new
 * destination, a cleared destination, or a new Anchor away from the destination.
 */

export interface ArrivalState {
  shown: boolean;
  destId: string; // '' when no destination
  driftSince: number | null; // when start first differed from dest while shown
  appearance: number; // increments on every Hidden -> Shown transition
}

export interface ArrivalInput {
  startId: string | null; // route start node (App's fromId)
  destId: string; // '' when none selected
  anchorNodeId: string | null; // node of a just-set manual/ble Anchor, else null
  t: number;
}

export const INITIAL_ARRIVAL_STATE: ArrivalState = {
  shown: false,
  destId: '',
  driftSince: null,
  appearance: 0,
};

/** Hidden state for `destId`; keeps `appearance` so React keys stay unique. */
function hidden(s: ArrivalState, destId: string): ArrivalState {
  return { shown: false, destId, driftSince: null, appearance: s.appearance };
}

export function stepArrival(
  s: ArrivalState,
  i: ArrivalInput,
  dwellMs: number = ARRIVAL_DWELL_MS,
): ArrivalState {
  // 6.6: no destination selected.
  if (i.destId === '') return hidden(s, '');

  // 6.10: a destination change hides immediately.
  const shown = i.destId === s.destId ? s.shown : false;

  // 6.1, 6.3, 6.5, 6.9: at the destination. Re-arriving while shown is a no-op.
  if (i.startId === i.destId) {
    const appearance = shown ? s.appearance : s.appearance + 1;
    return { shown: true, destId: i.destId, driftSince: null, appearance };
  }

  if (!shown) return hidden(s, i.destId);

  // 6.10: a new Anchor away from the destination hides immediately.
  if (i.anchorNodeId !== null) return hidden(s, i.destId);

  // 6.8, 6.9: drift dwell.
  const since = s.driftSince ?? i.t;
  if (i.t - since >= dwellMs) return hidden(s, i.destId);
  return { shown: true, destId: i.destId, driftSince: since, appearance: s.appearance };
}

/** Time at which stepArrival would hide a drifting card, or null. */
export function arrivalDeadline(
  s: ArrivalState,
  dwellMs: number = ARRIVAL_DWELL_MS,
): number | null {
  return s.shown && s.driftSince !== null ? s.driftSince + dwellMs : null;
}
