import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { indexBuilding, findRoute, describeRoute, snapToGraph, nearestNode, destinations, routeHeadingAt } from '../src/lib/graph.ts';
import {
  BeaconTracker,
  REFERENCE_MEASURED_POWER,
  averageRssiBatch,
  calibrateRssi,
  parseBeaconCalibration,
  parseBeaconName,
} from '../src/lib/beacon-math.ts';
import { advanceStep, StepDetector, HeadingFilter } from '../src/lib/pdr-math.ts';
import { GyroCompassFusion, WrongWayDetector, headingDelta } from '../src/lib/fusion-math.ts';
import { parseDeepLink } from '../src/lib/deeplink.ts';

import { PositionEngine } from '../src/positioning/engine.ts';
import { STEP_LENGTH_M } from '../src/config.ts';
import { arrivalStartId } from '../src/lib/arrival.ts';
import type { Building, Position } from '../src/lib/types.ts';

// Real map: only checked for consistency, so editing it never breaks the logic tests below.
const realBuilding = JSON.parse(readFileSync(new URL('../src/data/building.json', import.meta.url), 'utf8')) as Building;
// Frozen copy of the original demo map; the routing / PDR tests are written against its node ids.
const building = JSON.parse(readFileSync(new URL('./fixtures/demo-building.json', import.meta.url), 'utf8')) as Building;
const idx = indexBuilding(building);

test('building data is internally consistent', () => {
  const ids = new Set(realBuilding.nodes.map((n) => n.id));
  assert.equal(ids.size, realBuilding.nodes.length, 'duplicate node ids');
  for (const e of realBuilding.edges) assert.ok(ids.has(e.from) && ids.has(e.to), `${e.from}->${e.to}`);
  for (const b of realBuilding.beacons) assert.ok(ids.has(b.node), `beacon ${b.id}`);
  for (const n of realBuilding.nodes) assert.ok(realBuilding.floors.some((f) => f.id === n.floor));
});

test('real map: every node is on its plan and connected, every destination reachable', () => {
  const realIdx = indexBuilding(realBuilding);
  const linked = new Set(realBuilding.edges.flatMap((e) => [e.from, e.to]));
  for (const n of realBuilding.nodes) {
    const f = realBuilding.floors.find((fl) => fl.id === n.floor)!;
    assert.ok(n.x >= 0 && n.y >= 0 && n.x <= f.width && n.y <= f.height, `${n.id} is outside floor ${f.id}`);
    // an unconnected node can become the route start (nearest node) and make every route fail
    assert.ok(linked.has(n.id), `${n.id} has no edges`);
  }
  const dests = destinations(realBuilding);
  for (const a of dests) for (const b of dests) {
    if (a.id !== b.id) assert.ok(findRoute(realIdx, a.id, b.id, {}), `no route ${a.id} -> ${b.id}`);
  }
});

test('real map demo route: Club Hub -> Student Engagement turns left at the crossroads, A-255 turns right', () => {
  const realIdx = indexBuilding(realBuilding);
  const toEngagement = findRoute(realIdx, 'f2_club_hub', 'f2_student_engagement')!;
  assert.deepEqual(toEngagement.nodes, ['f2_club_hub', 'f2_restrooms', 'f2_crossroads', 'f2_student_engagement']);
  const left = describeRoute(realIdx, toEngagement).map((s) => s.text);
  assert.deepEqual(left, ['Start at Club Hub (A-240)', 'Turn left at the intersection', 'Arrive at Student Engagement (A-220)'], left.join(' | '));
  const right = describeRoute(realIdx, findRoute(realIdx, 'f2_club_hub', 'f2_a255')!).map((s) => s.text);
  assert.deepEqual(right, ['Start at Club Hub (A-240)', 'Turn right at the intersection', 'Arrive at A-255'], right.join(' | '));
});

test('real map tech demo walk: B1 Club Hub -> B2 A-255 -> B3 Student Engagement', () => {
  // Compass heading for a plan direction on this map: plan "up" points to northOffsetDeg.
  const compass = (planDeg: number) => (planDeg + realBuilding.northOffsetDeg) % 360;
  const DOWN = compass(180), WEST = compass(270), EAST = compass(90);
  const ids = Object.fromEntries(realBuilding.beacons.map((b) => [b.id, b.node]));
  assert.deepEqual(ids, { B1: 'f2_club_hub', B2: 'f2_a255', B3: 'f2_student_engagement' });

  const engine = new PositionEngine(realBuilding, STEP_LENGTH_M);
  engine.clear();
  const realIdx = engine.idx;
  let t = 0;
  const walk = (headingDeg: number, steps: number) => {
    for (let i = 0; i < steps; i++) engine.onStep({ headingDeg, accelerationPeak: 2, timestamp: (t += 500) });
  };
  const stepsFor = (units: number) => Math.round((units * realBuilding.metersPerUnit) / STEP_LENGTH_M);

  // 1. Standing at Club Hub: B1 gives the first fix.
  engine.onBeacon({ id: 'B1', rssi: -60 });
  assert.equal(engine.position!.nodeId, 'f2_club_hub');

  // 2. Walk down the hallway toward A-255. A stray loud B3 must not pull the dot away.
  engine.setRoute(findRoute(realIdx, 'f2_club_hub', 'f2_a255')!.nodes);
  walk(DOWN, stepsFor(432 - 272));
  assert.ok(Math.abs(engine.position!.y - 432) < 6, `at the crossroads, y=${engine.position!.y}`);
  const atCrossroads = engine.position!;
  engine.onBeacon({ id: 'B3', rssi: -74 });
  assert.deepEqual(engine.position, atCrossroads, 'far beacon ignored');

  // 3. Turn right (west) to A-255. Approaching, B2 reads like "20 ft away" (-71, measured):
  //    no snap. At the door it reads -53 (measured): snap.
  walk(WEST, stepsFor(258 - 212) - 1);
  const approaching = engine.position!;
  engine.onBeacon({ id: 'B2', rssi: -71 });
  assert.deepEqual(engine.position, approaching, '20 ft away is not "at A-255"');
  engine.onBeacon({ id: 'B2', rssi: -53 });
  assert.equal(engine.position!.nodeId, 'f2_a255');
  assert.equal(engine.pendingBeacon, null);

  // 4. Turn around and walk east past the crossroads to Student Engagement: B3 accepted.
  engine.setRoute(findRoute(realIdx, 'f2_a255', 'f2_student_engagement')!.nodes);
  walk(EAST, stepsFor(430 - 212) - 2);
  engine.onBeacon({ id: 'B3', rssi: -58 });
  assert.equal(engine.position!.nodeId, 'f2_student_engagement');
});

test('real map: walking past the crossroads to Student Engagement does not snap to A-255', () => {
  // The bug seen on site: B2 (A-255, ~8 m from the crossroads) read about -74 dBm there and pulled the dot.
  const compass = (planDeg: number) => (planDeg + realBuilding.northOffsetDeg) % 360;
  const engine = new PositionEngine(realBuilding, STEP_LENGTH_M);
  engine.clear();
  engine.onBeacon({ id: 'B1', rssi: -60 });
  engine.setRoute(findRoute(engine.idx, 'f2_club_hub', 'f2_student_engagement')!.nodes);
  const steps = Math.round(((432 - 272) * realBuilding.metersPerUnit) / STEP_LENGTH_M);
  for (let i = 1; i <= steps; i++) engine.onStep({ headingDeg: compass(180), accelerationPeak: 2, timestamp: i * 500 });
  const atCrossroads = engine.position!;
  for (const rssi of [-74, -72, -71, -74]) engine.onBeacon({ id: 'B2', rssi });
  assert.deepEqual(engine.position, atCrossroads, 'no snap to A-255');
  assert.notEqual(engine.position!.nodeId, 'f2_a255');
  assert.equal(engine.pendingBeacon, null, 'weak readings are not even counted toward a forced switch');
});

test('real map: arrival at A-255 needs a fix there or the dot within 2 m (on-site early "arrived")', () => {
  const realIdx = indexBuilding(realBuilding);
  const dest = 'f2_a255'; // (212, 432); 0.18 m per unit
  const pdr = (x: number, y: number): Position => ({ floor: 'f2', x, y, source: 'pdr', timestamp: 0 });
  const near = (p: Position) => nearestNode(realIdx, p.floor, p.x, p.y)!.id;

  // Screenshot on site: dot at (230, 432) via steps, ~3.2 m out, nearest node already A-255.
  const early = pdr(230, 432);
  assert.equal(near(early), dest);
  assert.equal(arrivalStartId(realIdx, early, dest, near(early)), null, 'not arrived yet');

  const close = pdr(220, 432); // ~1.4 m out
  assert.equal(arrivalStartId(realIdx, close, dest, near(close)), dest);

  const anchored: Position = { ...pdr(212, 432), nodeId: dest, source: 'ble' };
  assert.equal(arrivalStartId(realIdx, anchored, dest, dest), dest, 'Bluetooth fix at the destination');

  // Not the destination: passes the route start through unchanged.
  const hall = pdr(258, 350);
  assert.equal(arrivalStartId(realIdx, hall, dest, near(hall)), near(hall));
  assert.equal(arrivalStartId(realIdx, null, dest, null), null);
});

test('same-floor route and distance', () => {
  const r = findRoute(idx, 'f1_entrance', 'f1_r_c')!;
  assert.deepEqual(r.nodes, ['f1_entrance', 'f1_j1', 'f1_j2', 'f1_j3', 'f1_r_c']);
  assert.ok(Math.abs(r.distanceMeters - (200 + 200 + 200 + 100) * 0.1) < 1e-9);
});

test('cross-floor route uses a floor-change edge', () => {
  const r = findRoute(idx, 'f1_entrance', 'f2_r_c')!;
  assert.ok(r.nodes.includes('f1_stairs') || r.nodes.includes('f1_elev'));
  assert.equal(r.nodes.at(-1), 'f2_r_c');
});

test('accessible routing never uses stairs', () => {
  const r = findRoute(idx, 'f1_entrance', 'f2_r_c', { accessible: true })!;
  assert.ok(r.nodes.includes('f1_elev'));
  assert.ok(!r.nodes.includes('f1_stairs'));
});

test('unreachable when accessible and only stairs exist', () => {
  const noElev: Building = { ...building, edges: building.edges.filter((e) => e.type !== 'elevator') };
  const r = findRoute(indexBuilding(noElev), 'f1_entrance', 'f2_r_c', { accessible: true });
  assert.equal(r, null);
});

test('directions include turns, floor change, and arrival', () => {
  const r = findRoute(idx, 'f1_entrance', 'f2_r_c', { accessible: true })!;
  const steps = describeRoute(idx, r).map((s) => s.text);
  console.log(steps.join('\n'));
  assert.ok(steps[0].startsWith('Start at Main Entrance'));
  assert.ok(steps.some((s) => s.includes('Take the elevator to Floor 2')));
  assert.equal(steps.at(-1), 'Arrive at Room 203');
});

test('turn direction: heading east then north-on-screen is a LEFT turn', () => {
  // f1_j1 (300,300) -> f1_j2 (500,300) -> f1_stairs (500,200): plan y down, so (500,200) is up/left of travel
  const r = findRoute(idx, 'f1_j1', 'f1_stairs')!;
  const steps = describeRoute(idx, r).map((s) => s.text);
  assert.ok(steps.some((s) => s.startsWith('Turn left')), steps.join(' | '));
  const r2 = findRoute(idx, 'f1_j1', 'f1_elev')!;
  assert.ok(describeRoute(idx, r2).some((s) => s.text.startsWith('Turn right')));
});

test('snap to graph projects onto the corridor', () => {
  const s = snapToGraph(idx, 'f1', 400, 330);
  assert.equal(Math.round(s.y), 300);
  assert.equal(Math.round(s.x), 400);
});

test('nearest node and destinations', () => {
  assert.equal(nearestNode(idx, 'f1', 310, 290)!.id, 'f1_j1');
  const names = destinations(building).map((n) => n.name);
  assert.ok(names.includes('Cafe') && !names.includes(undefined as never));
});

test('beacon tracker: picks strongest, hysteresis prevents flapping, stale expires', () => {
  const t = new BeaconTracker();
  for (let i = 0; i < 10; i++) { t.update('B1', -60, i * 500); t.update('B2', -75, i * 500); }
  assert.equal(t.best(5000)!.id, 'B1');
  // B2 becomes only slightly stronger -> no switch
  for (let i = 0; i < 20; i++) { t.update('B1', -70, 5000 + i * 100); t.update('B2', -67, 5000 + i * 100); }
  assert.equal(t.best(7000)!.id, 'B1');
  // B1 fades out of range and B2 is clearly stronger: it still needs a second fresh
  // one-second batch before taking over (no instant hand-off).
  for (let i = 0; i < 30; i++) { t.update('B1', -85, 7000 + i * 100); t.update('B2', -55, 7000 + i * 100); }
  assert.equal(t.best(10000), null);
  t.update('B2', -55, 11000);
  assert.equal(t.best(11000)!.id, 'B2');
  // nothing heard for a long time -> null
  assert.equal(t.best(60000), null);
});

test('beacon switch confirmation requires a fresh RSSI batch', () => {
  const t = new BeaconTracker();
  t.update('B1', -60, 0);
  assert.equal(t.best(0)!.id, 'B1');
  t.update('B2', -40, 1000);
  assert.equal(t.best(1000)!.id, 'B1', 'first fresh challenger batch only starts confirmation');
  assert.equal(t.best(2000)!.id, 'B1', 'an empty batch must not confirm stale RSSI');
  t.update('B2', -40, 2000);
  assert.equal(t.best(2000)!.id, 'B2', 'second fresh challenger batch confirms switch');
});

test('beacon tracker: current beacon briefly out of range does not hand over to the next one', () => {
  const t = new BeaconTracker();
  t.update('B2', -60, 0);
  assert.equal(t.best(0)!.id, 'B2');
  // B2 silent long enough to go stale; B3 heard once -> not confirmed, report nothing
  t.update('B3', -70, 5000);
  assert.equal(t.best(5000), null);
  // B2 comes back -> stays B2
  t.update('B2', -60, 6000);
  assert.equal(t.best(6000)!.id, 'B2');
  // if B2 is really gone and B3 persists, it still takes over after fresh confirmations
  t.update('B3', -70, 11000);
  assert.equal(t.best(11000), null);
  t.update('B3', -70, 12000);
  assert.equal(t.best(12000)!.id, 'B3');
});

test('beacon tracker ignores very weak signals', () => {
  const t = new BeaconTracker();
  t.update('B1', -97, 0);
  assert.equal(t.best(100), null);
});

test('beacon tracker does not anchor to a distant beacon (~20 m away)', () => {
  const t = new BeaconTracker();
  for (let i = 0; i < 10; i++) t.update('B1', -88, i * 200);
  assert.equal(t.best(2000), null);
  assert.equal(t.snapshot(2000).length, 1, 'still shown in the debug panel');
});

test('one-second RSSI batch averages noise and drops extreme outliers', () => {
  assert.equal(averageRssiBatch([-60, -61, -59]), -60);
  assert.equal(averageRssiBatch([-100, -61, -60, -59, -20]), -60);
  assert.ok(Number.isNaN(averageRssiBatch([])));
});

test('parseBeaconCalibration reads the firmware scan-response payload', () => {
  // [version 1, measuredPower -59 as int8 (0xC5), pathLoss 2.0 (20), rev 3]
  assert.deepEqual(parseBeaconCalibration(new Uint8Array([1, 0xc5, 20, 3])), { measuredPower: -59, pathLoss: 2, rev: 3 });
  assert.deepEqual(parseBeaconCalibration([1, 0xce, 22, 255]), { measuredPower: -50, pathLoss: 2.2, rev: 255 });
  assert.equal(parseBeaconCalibration([2, 0xc5, 20, 3]), null, 'unknown format version');
  assert.equal(parseBeaconCalibration([1, 0xc5, 20]), null, 'too short');
  assert.equal(parseBeaconCalibration([1, 5, 20, 0]), null, 'measuredPower above 0 dBm');
  assert.equal(parseBeaconCalibration([1, 0xc5, 70, 0]), null, 'pathLoss above 6.0');
});

test('calibrateRssi removes per-board loudness relative to the reference board', () => {
  assert.equal(calibrateRssi(-70, REFERENCE_MEASURED_POWER), -70, 'reference board unchanged');
  assert.equal(calibrateRssi(-70, -50), -79, 'board 9 dB hotter than reference is turned down 9 dB');
  assert.equal(calibrateRssi(-70, -65), -64, 'quiet board is turned up');
  assert.equal(calibrateRssi(-70, null), -70, 'no calibration: unchanged');
  assert.equal(calibrateRssi(-70, undefined), -70);
});

test('calibration stops a loud far board from beating a quiet near one (Info Desk vs Exit B)', () => {
  // Standing at the Info Desk: B2 (quiet board, 1 m = -66) is near; B3 (loud board, 1 m = -52) is ~15 m away.
  // Raw, B3 reads louder. Calibrated, B2 is clearly closer.
  const raw = { B2: -71, B3: -67 };
  const cal = { B2: -66, B3: -52 };

  const uncalibrated = new BeaconTracker();
  uncalibrated.update('B2', raw.B2, 0);
  uncalibrated.update('B3', raw.B3, 0);
  assert.equal(uncalibrated.best(0)?.id, 'B3', 'raw ranking picks the loud far board');

  const calibrated = new BeaconTracker();
  for (let s = 0; s < 6; s++) {
    calibrated.update('B2', calibrateRssi(raw.B2, cal.B2), s * 1000);
    calibrated.update('B3', calibrateRssi(raw.B3, cal.B3), s * 1000);
    assert.equal(calibrated.best(s * 1000)?.id, 'B2', `second ${s}`);
  }
  // -71 - (-66 - -59) = -64 for B2; -67 - (-52 - -59) = -74 for B3
  assert.equal(calibrateRssi(raw.B2, cal.B2), -64);
  assert.equal(calibrateRssi(raw.B3, cal.B3), -74);
});

test('parseBeaconName', () => {
  assert.equal(parseBeaconName('CNAV-B1', 'CNAV-'), 'B1');
  assert.equal(parseBeaconName('Other', 'CNAV-'), null);
  assert.equal(parseBeaconName(undefined, 'CNAV-'), null);
});

test('PDR walks east along the corridor and stays snapped', () => {
  let pos: Position = { floor: 'f1', x: 300, y: 300, nodeId: 'f1_j1', source: 'manual', timestamp: 0 };
  for (let i = 0; i < 10; i++) pos = advanceStep(idx, pos, 90, 0.7, i); // east, 10 steps = 7 m = 70 units
  assert.ok(Math.abs(pos.x - 370) < 1e-6, `x=${pos.x}`);
  assert.ok(Math.abs(pos.y - 300) < 1e-6);
  // heading north from mid-corridor (no junction here) can't leave the corridor
  const p2 = advanceStep(idx, pos, 0, 0.7, 11);
  assert.ok(Math.abs(p2.y - 300) < 1e-6);
});

test('PDR respects northOffsetDeg', () => {
  const rotated = indexBuilding({ ...building, northOffsetDeg: 90 }); // plan "up" is east
  const pos: Position = { floor: 'f1', x: 300, y: 300, source: 'manual', timestamp: 0 };
  const p = advanceStep(rotated, pos, 90, 0.7, 1); // walking true east == plan up (blocked on corridor)
  assert.ok(Math.abs(p.x - 300) < 1e-6 || Math.abs(p.y - 300) < 1e-6);
  const q = advanceStep(rotated, pos, 180, 0.7, 1); // true south == plan right (east in plan)
  assert.ok(q.x > 300);
});

test('step detector counts ~1 step per synthetic stride', () => {
  const d = new StepDetector();
  let steps = 0;
  // 2 Hz walking at 50 Hz sampling for 10 s -> 20 steps
  for (let i = 0; i < 500; i++) {
    const t = i * 20;
    const mag = 9.81 + 3 * Math.sin(2 * Math.PI * 2 * (t / 1000));
    if (d.push(mag, t)) steps++;
  }
  assert.ok(steps >= 17 && steps <= 21, `steps=${steps}`);
});

test('step detector does not fire while stationary', () => {
  const d = new StepDetector();
  let steps = 0;
  for (let i = 0; i < 500; i++) if (d.push(9.81 + 0.1 * Math.sin(i), i * 20)) steps++;
  assert.equal(steps, 0);
});

test('heading filter handles 359 -> 1 wraparound', () => {
  const f = new HeadingFilter(0.5);
  f.push(359);
  const v = f.push(1);
  assert.ok(v > 355 || v < 5, `v=${v}`);
});

test('gyro/compass fusion integrates turns and compass removes drift', () => {
  const f = new GyroCompassFusion(0.5);
  assert.equal(f.pushCompass(350), 350);
  assert.equal(Math.round(f.pushGyro(20, 0.5)!), 350, 'rejects implausibly long gyro interval');
  assert.equal(Math.round(f.pushGyro(20, 0.2)!), 354);
  assert.equal(Math.round(f.pushCompass(2)!), 358, 'corrects across north without wrapping the long way');
  assert.equal(Math.round(f.pushCompass(90, 90)!), 358, 'rejects inaccurate compass reading');
  assert.equal(headingDelta(350, 10), 20);
});

test('wrong-way warning requires sustained opposite steps and clears after recovery', () => {
  const d = new WrongWayDetector(3, 2, 105);
  assert.equal(d.push(270, 90).wrongWay, false);
  assert.equal(d.push(275, 90).wrongWay, false);
  assert.equal(d.push(280, 90).wrongWay, true);
  assert.equal(d.push(95, 90).wrongWay, true);
  assert.equal(d.push(90, 90).wrongWay, false);
});

test('route heading converts the plan segment to a compass heading', () => {
  assert.equal(Math.round(routeHeadingAt(idx, ['f1_j1', 'f1_j2'], 'f1', 350, 300)!), 90);
  assert.equal(routeHeadingAt(idx, ['f1_j1', 'f1_j2'], 'f1', 350, 500, 3), null);
});

test('position engine combines accelerometer-confirmed steps with route-aware wrong-way state', () => {
  const engine = new PositionEngine(building, 0.7);
  assert.equal(engine.setAnchor('f1_j1', 'manual'), true);
  engine.setRoute(['f1_j1', 'f1_j2']); // east (90°)
  for (let i = 1; i <= 3; i++) {
    engine.onStep({ headingDeg: 270, accelerationPeak: 2, timestamp: i * 500 });
  }
  assert.equal(engine.navigation.wrongWay, true);
  assert.ok(engine.position!.x < 300, `x=${engine.position!.x}`);
  engine.onStep({ headingDeg: 90, accelerationPeak: 2, timestamp: 2000 });
  engine.onStep({ headingDeg: 90, accelerationPeak: 2, timestamp: 2500 });
  assert.equal(engine.navigation.wrongWay, false);
});

test('brief beacon loss cannot bypass same-beacon correction gates', () => {
  const engine = new PositionEngine(building, 0.7);
  engine.onBeacon({ id: 'B1', rssi: -60 });
  for (let i = 1; i <= 3; i++) {
    engine.onStep({ headingDeg: 90, accelerationPeak: 2, timestamp: i * 500 });
  }
  const before = engine.position!;
  assert.ok(before.x > 500);
  engine.onBeacon(null);
  engine.onBeacon({ id: 'B1', rssi: -75 });
  assert.deepEqual(engine.position, before, 'weak reacquisition must not snap back to B1');
});

test('dead reckoning rejects a far beacon while walking B1 -> B2, but accepts the next one', () => {
  // B1 at x=300, B2 at x=500 (20 m), B3 at x=900 (60 m), all on one corridor
  const line: Building = {
    ...building,
    beacons: [
      { id: 'B1', node: 'f1_j1' },
      { id: 'B2', node: 'f1_j2' },
      { id: 'B3', node: 'f1_east_exit' },
    ],
  };
  const engine = new PositionEngine(line, 0.7);
  engine.clear();
  engine.onBeacon({ id: 'B1', rssi: -60 }); // first fix accepted
  assert.equal(engine.position!.nodeId, 'f1_j1');
  for (let i = 1; i <= 20; i++) engine.onStep({ headingDeg: 90, accelerationPeak: 2, timestamp: i * 500 });
  const walked = engine.position!;
  assert.ok(Math.abs(walked.x - 440) < 1e-6, `x=${walked.x}`); // 14 m east

  // B2 drops out and far-away B3 is loudest (and strong enough to anchor) for a few seconds
  // -> dead reckoning still keeps the step estimate
  for (let i = 0; i < 5; i++) engine.onBeacon({ id: 'B3', rssi: -62 });
  assert.deepEqual(engine.position, walked);
  assert.equal(engine.pendingBeacon!.id, 'B3');

  // B2 is plausible (6 m ahead) -> accepted immediately and the pending B3 is dropped
  engine.onBeacon({ id: 'B2', rssi: -62 });
  assert.equal(engine.position!.nodeId, 'f1_j2');
  assert.equal(engine.pendingBeacon, null);
});

test('a persistent implausible beacon is eventually accepted (recovery when truly lost)', () => {
  const engine = new PositionEngine(building, 0.7);
  engine.clear();
  engine.onBeacon({ id: 'B1', rssi: -60 }); // f1_j2
  for (let i = 1; i < 6; i++) {
    engine.onBeacon({ id: 'B3', rssi: -62 }); // other floor -> implausible
    assert.equal(engine.position!.nodeId, 'f1_j2', `report ${i}`);
  }
  engine.onBeacon({ id: 'B3', rssi: -62 });
  assert.equal(engine.position!.nodeId, 'f2_j2');
});

test('parseDeepLink', () => {
  assert.deepEqual(parseDeepLink('https://x.app/?at=f1_j2&to=f2_r_c'), { at: 'f1_j2', to: 'f2_r_c' });
  assert.deepEqual(parseDeepLink('http://localhost:5173/?to=f2_r_c'), { at: undefined, to: 'f2_r_c' });
  assert.equal(parseDeepLink('https://example.com/'), null);
  assert.equal(parseDeepLink('f1_j2'), null);
  assert.equal(parseDeepLink(''), null);
});
