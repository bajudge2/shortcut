import { HeadingFilter, StepDetector } from '../lib/pdr-math.ts';

type OrientationEventIOS = DeviceOrientationEvent & { webkitCompassHeading?: number };
type PermissionedEvent = { requestPermission?: () => Promise<'granted' | 'denied'> };

/**
 * Step counter + compass heading from the phone's motion sensors.
 * start() MUST be called from a user tap (iOS requires a gesture for sensor permission).
 */
export class MotionSensors {
  private detector = new StepDetector();
  private heading = new HeadingFilter();
  private headingDeg: number | null = null;
  private wake: WakeLockSentinel | null = null;
  private onMotion: ((e: DeviceMotionEvent) => void) | null = null;
  private onOrient: ((e: Event) => void) | null = null;
  steps = 0;

  get currentHeading(): number | null { return this.headingDeg; }
  get isRunning(): boolean { return this.onMotion !== null; }

  async start(onStep: (headingDeg: number) => void): Promise<void> {
    if (this.isRunning) return;

    const DM = DeviceMotionEvent as unknown as PermissionedEvent;
    if (typeof DM.requestPermission === 'function') {
      const res = await DM.requestPermission(); // first await inside the tap handler
      if (res !== 'granted') throw new Error('Motion permission denied (Settings > Safari/Shortcut > Motion & Orientation)');
    }
    const DO = DeviceOrientationEvent as unknown as PermissionedEvent;
    if (typeof DO.requestPermission === 'function') {
      try { await DO.requestPermission(); } catch { /* one grant usually covers both */ }
    }

    this.onOrient = (e: Event) => {
      const ev = e as OrientationEventIOS;
      let h: number | null = null;
      if (typeof ev.webkitCompassHeading === 'number') h = ev.webkitCompassHeading; // iOS: true compass
      else if (ev.absolute && typeof ev.alpha === 'number') h = (360 - ev.alpha) % 360;
      if (h !== null) this.headingDeg = this.heading.push(h);
    };
    this.onMotion = (e: DeviceMotionEvent) => {
      const a = e.accelerationIncludingGravity;
      if (!a || a.x == null || a.y == null || a.z == null) return;
      const mag = Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);
      if (this.detector.push(mag, Date.now()) && this.headingDeg !== null) {
        this.steps++;
        onStep(this.headingDeg);
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
    void this.wake?.release().catch(() => undefined);
    this.wake = null;
  }
}
