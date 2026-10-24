import { useEffect, useRef, useState } from 'react';
import type { Position } from '../lib/types.ts';
import { newAnchorNodeId } from '../lib/anchor.ts';
import {
  INITIAL_ARRIVAL_STATE,
  arrivalDeadline,
  stepArrival,
  type ArrivalState,
} from '../lib/arrival.ts';

interface ArrivalOpts {
  startId: string | null;
  destId: string;
  position: Position | null;
}

/**
 * Runs the arrival dwell state machine (Requirement 6) against the route start, destination
 * and live Position, and schedules a single timer to hide a drifting card at its deadline.
 */
export function useArrival(opts: ArrivalOpts): { shown: boolean; appearance: number } {
  const { startId, destId, position } = opts;

  const [state, setState] = useState<ArrivalState>(INITIAL_ARRIVAL_STATE);
  // Source of truth for stepping; `state` mirrors it for rendering. Stepping from the ref keeps
  // repeated effect runs (StrictMode) idempotent: re-stepping a Shown state never re-counts.
  const stateRef = useRef<ArrivalState>(INITIAL_ARRIVAL_STATE);
  const prevPosRef = useRef<Position | null>(null);
  const inputsRef = useRef({ startId, destId });
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  inputsRef.current = { startId, destId };

  useEffect(() => {
    const clearTimer = () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };

    const step = (anchorNodeId: string | null) => {
      clearTimer();
      const now = Math.floor(performance.now());
      const next = stepArrival(stateRef.current, {
        startId: inputsRef.current.startId,
        destId: inputsRef.current.destId,
        anchorNodeId,
        t: now,
      });
      stateRef.current = next;
      setState(next);

      const deadline = arrivalDeadline(next);
      if (deadline !== null) {
        const wait = Math.max(0, deadline - now);
        timerRef.current = setTimeout(() => {
          timerRef.current = null;
          step(null);
        }, wait);
      }
    };

    const anchorNodeId = newAnchorNodeId(prevPosRef.current, position);
    prevPosRef.current = position;
    step(anchorNodeId);

    return clearTimer;
  }, [startId, destId, position]);

  return { shown: state.shown, appearance: state.appearance };
}
