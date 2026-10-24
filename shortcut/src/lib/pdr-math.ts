import { snapToGraph, type BuildingIndex } from './graph.ts';
import type { Position } from './types.ts';

/**
 * Pedestrian dead reckoning: advance one step in the compass direction,
 * then snap back onto the nearest corridor of the current floor.
 * @param headingDeg compass heading, 0 = north, clockwise
 */
export function advanceStep(
  idx: BuildingIndex,
  pos: Position,
  headingDeg: number,
  stepLengthM: number,
  now: number,
): Position {
  const b = idx.building;
  const planAngle = ((headingDeg - b.northOffsetDeg) * Math.PI) / 180; // 0 = plan "up"
  const stepUnits = stepLengthM / b.metersPerUnit;
  const rawX = pos.x + Math.sin(planAngle) * stepUnits;
  const rawY = pos.y - Math.cos(planAngle) * stepUnits; // plan y grows downward
  const snapped = snapToGraph(idx, pos.floor, rawX, rawY);
  if (!isFinite(snapped.distance)) return pos;
  return { floor: pos.floor, x: snapped.x, y: snapped.y, source: 'pdr', timestamp: now };
}

export interface StepObservation {
  /** fused compass + gyroscope heading: degrees clockwise from north */
  headingDeg: number;
  /** acceleration peak above the gravity baseline, m/s² */
  accelerationPeak: number;
  timestamp: number;
}

/** Detects steps as upward crossings of a threshold on high-passed acceleration magnitude. */
export class StepDetector {
  private slow = 9.81;
  private fast = 9.81;
  private armed = true;
  private lastStepAt = 0;
  private peak = 0;
  constructor(
    private threshold = 1.2, // m/s^2
    private minIntervalMs = 300,
  ) {}

  /** @returns true if a step was detected for this sample */
  push(magnitude: number, now: number): boolean {
    this.slow += 0.02 * (magnitude - this.slow);  // gravity / drift baseline
    this.fast += 0.35 * (magnitude - this.fast);  // smoothed signal
    const v = this.fast - this.slow;
    this.peak = Math.max(this.peak * 0.9, Math.abs(v));
    if (v < this.threshold * 0.4) this.armed = true;
    if (this.armed && v > this.threshold && now - this.lastStepAt > this.minIntervalMs) {
      this.armed = false;
      this.lastStepAt = now;
      return true;
    }
    return false;
  }

  get lastPeak(): number { return this.peak; }

  reset(): void {
    this.slow = 9.81;
    this.fast = 9.81;
    this.armed = true;
    this.lastStepAt = 0;
    this.peak = 0;
  }
}

/** Smooths compass headings on the circle (handles the 359 -> 0 wrap). */
export class HeadingFilter {
  private sin = 0;
  private cos = 0;
  private has = false;
  constructor(private alpha = 0.2) {}
  push(deg: number): number {
    const r = (deg * Math.PI) / 180;
    if (!this.has) { this.sin = Math.sin(r); this.cos = Math.cos(r); this.has = true; }
    else {
      this.sin += this.alpha * (Math.sin(r) - this.sin);
      this.cos += this.alpha * (Math.cos(r) - this.cos);
    }
    return this.value();
  }
  value(): number {
    return ((Math.atan2(this.sin, this.cos) * 180) / Math.PI + 360) % 360;
  }
}
