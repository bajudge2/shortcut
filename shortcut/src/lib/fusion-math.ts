/** Pure sensor-fusion helpers. No browser, React, or Capacitor dependencies. */

export function normalizeHeading(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

/** Smallest signed rotation from `from` to `to`, in degrees (-180, 180]. */
export function headingDelta(from: number, to: number): number {
  let d = normalizeHeading(to) - normalizeHeading(from);
  while (d > 180) d -= 360;
  while (d <= -180) d += 360;
  return d;
}

/**
 * Complementary heading filter: gyroscope supplies smooth short-term turns while
 * the compass slowly removes gyro drift. Gyro alone is never treated as absolute.
 */
export class GyroCompassFusion {
  private heading: number | null = null;

  constructor(private compassGain = 0.1, private maxCompassAccuracyDeg = 45) {}

  get value(): number | null { return this.heading; }

  pushCompass(headingDeg: number, accuracyDeg?: number): number | null {
    if (!Number.isFinite(headingDeg)) return this.heading;
    // iOS commonly reports -1 when accuracy is unavailable; allow that value.
    if (accuracyDeg !== undefined && accuracyDeg >= 0 && accuracyDeg > this.maxCompassAccuracyDeg) return this.heading;
    const compass = normalizeHeading(headingDeg);
    if (this.heading === null) this.heading = compass;
    else this.heading = normalizeHeading(this.heading + this.compassGain * headingDelta(this.heading, compass));
    return this.heading;
  }

  /** yawRateDegPerSec is positive for a clockwise/right turn. */
  pushGyro(yawRateDegPerSec: number, dtSec: number): number | null {
    if (this.heading === null || !Number.isFinite(yawRateDegPerSec) || dtSec <= 0 || dtSec > 0.25) return this.heading;
    this.heading = normalizeHeading(this.heading + yawRateDegPerSec * dtSec);
    return this.heading;
  }

  reset(): void { this.heading = null; }
}

export interface WrongWayState {
  wrongWay: boolean;
  headingErrorDeg: number | null;
}

/** Requires several actual steps in the opposite direction before warning. */
export class WrongWayDetector {
  private oppositeSteps = 0;
  private alignedSteps = 0;
  private state: WrongWayState = { wrongWay: false, headingErrorDeg: null };

  constructor(private triggerSteps = 3, private clearSteps = 2, private oppositeAngleDeg = 105) {}

  push(actualHeadingDeg: number, expectedHeadingDeg: number | null): WrongWayState {
    if (expectedHeadingDeg === null) {
      this.reset();
      return this.state;
    }
    const error = Math.abs(headingDelta(expectedHeadingDeg, actualHeadingDeg));
    if (error >= this.oppositeAngleDeg) {
      this.oppositeSteps++;
      this.alignedSteps = 0;
      if (this.oppositeSteps >= this.triggerSteps) this.state = { wrongWay: true, headingErrorDeg: error };
      else this.state = { ...this.state, headingErrorDeg: error };
    } else {
      this.oppositeSteps = 0;
      this.alignedSteps++;
      if (this.alignedSteps >= this.clearSteps) this.state = { wrongWay: false, headingErrorDeg: error };
      else this.state = { ...this.state, headingErrorDeg: error };
    }
    return this.state;
  }

  reset(): void {
    this.oppositeSteps = 0;
    this.alignedSteps = 0;
    this.state = { wrongWay: false, headingErrorDeg: null };
  }
}
