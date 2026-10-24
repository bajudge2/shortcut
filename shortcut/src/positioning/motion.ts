import { GyroCompassFusion } from '../lib/fusion-math.ts';
import { StepDetector, type StepObservation } from '../lib/pdr-math.ts';

type OrientationEventIOS = DeviceOrientationEvent & {
  webkitCompassHeading?: number;
  webkitCompassAccuracy?: number;
};
type PermissionedEvent = { requestPermission?: () => Promise<'granted' | 'denied'> };

/**
 * Device-only motion adapter. Acceleration detects steps; gyroscope yaw makes turns
 * responsive between compass updates; the compass continuously removes gyro drift.
 * Hold the phone roughly flat/portrait with its top pointing in the walking direction.
 * start() MUST be called from a user tap (iOS requires a gesture for permission).
 */
export class MotionSensors {
  private detector = new StepDetector();
  private heading = new GyroCompassFusion();
  private headingDeg: number | null = null;
  private wake: WakeLockSentinel | null = null;
  private onMotion: ((e: DeviceMotionEvent) => void) | null = null;
  private onOrient: ((e: Event) => void) | null = null;
  steps = 0;

  get currentHeading(): number | null { return this.headingDeg; }
  get isRunning(): boolean { return this.onMotion !== null; }

  async start(onStep: (observation: StepObservation) => void): Promise<void> {
    if (this.isRunning) return;

    const DM = DeviceMotionEvent as unknown as PermissionedEvent;
    const DO = DeviceOrientationEvent as unknown as PermissionedEvent;
    const motionPermission = typeof DM.requestPermission === 'function' ? DM.requestPermission() : Promise.resolve('granted' as const);
    const orientationPermission = typeof DO.requestPermission === 'function' ? DO.requestPermission() : Promise.resolve('granted' as const);
    // Invoke both permission methods synchronously inside the tap gesture, then await together.
    const [motionResult, orientationResult] = await Promise.all([motionPermission, orientationPermission]);
    if (motionResult !== 'granted') throw new Error('Motion permission denied (Settings > Shortcut > Motion & Fitness)');
    if (orientationResult !== 'granted') throw new Error('Compass permission denied');

    // A new walking session must not inherit filter state or the debounce timestamp.
    this.detector = new StepDetector();
    this.heading = new GyroCompassFusion();
    this.headingDeg = null;
    this.steps = 0;

    this.onOrient = (e: Event) => {
      const ev = e as OrientationEventIOS;
      let compass: number | null = null;
      if (typeof ev.webkitCompassHeading === 'number') compass = ev.webkitCompassHeading;
      else if (ev.absolute && typeof ev.alpha === 'number') compass = (360 - ev.alpha) % 360;
      if (compass !== null) this.headingDeg = this.heading.pushCompass(compass, ev.webkitCompassAccuracy);
    };

    this.onMotion = (e: DeviceMotionEvent) => {
      const rotation = e.rotationRate;
      if (rotation && typeof rotation.alpha === 'number') {
        // iOS rotationRate follows the right-hand rule: clockwise/right yaw is negative z.
        this.headingDeg = this.heading.pushGyro(-rotation.alpha, (e.interval || 16.7) / 1000);
      }

      const a = e.accelerationIncludingGravity;
      if (!a || a.x == null || a.y == null || a.z == null) return;
      const magnitude = Math.hypot(a.x, a.y, a.z);
      const now = Date.now();
      if (this.detector.push(magnitude, now) && this.headingDeg !== null) {
        this.steps++;
        onStep({ headingDeg: this.headingDeg, accelerationPeak: this.detector.lastPeak, timestamp: now });
      }
    };

    window.addEventListener('deviceorientation', this.onOrient, true);
    window.addEventListener('devicemotion', this.onMotion);
    try { this.wake = (await navigator.wakeLock?.request('screen')) ?? null; } catch { /* optional */ }
  }

  stop(): void {
    if (this.onOrient) window.removeEventListener('deviceorientation', this.onOrient, true);
    if (this.onMotion) window.removeEventListener('devicemotion', this.onMotion);
    this.onOrient = null;
    this.onMotion = null;
    this.headingDeg = null;
    this.heading.reset();
    void this.wake?.release().catch(() => undefined);
    this.wake = null;
  }
}
