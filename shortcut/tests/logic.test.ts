import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { indexBuilding, findRoute, describeRoute, snapToGraph, nearestNode, destinations } from '../src/lib/graph.ts';
import { BeaconTracker, parseBeaconName } from '../src/lib/beacon-math.ts';
import { advanceStep, StepDetector, HeadingFilter } from '../src/lib/pdr-math.ts';
import { parseAnchor } from '../src/lib/anchor.ts';
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
  // B2 clearly stronger -> switch
  for (let i = 0; i < 30; i++) { t.update('B1', -85, 7000 + i * 100); t.update('B2', -55, 7000 + i * 100); }
  assert.equal(t.best(10000)!.id, 'B2');
  // nothing heard for a long time -> null
  assert.equal(t.best(60000), null);
});

test('beacon tracker ignores very weak signals', () => {
  const t = new BeaconTracker();
  t.update('B1', -97, 0);
  assert.equal(t.best(100), null);
});

test('parseBeaconName', () => {
  assert.equal(parseBeaconName('CNAV-B1', 'CNAV-'), 'B1');
  assert.equal(parseBeaconName('Other', 'CNAV-'), null);
  assert.equal(parseBeaconName(undefined, 'CNAV-'), null);
});

test('PDR walks east along the corridor and stays snapped', () => {
  let pos: Position = { floor: 'f1', x: 300, y: 300, nodeId: 'f1_j1', source: 'qr', timestamp: 0 };
  for (let i = 0; i < 10; i++) pos = advanceStep(idx, pos, 90, 0.7, i); // east, 10 steps = 7 m = 70 units
  assert.ok(Math.abs(pos.x - 370) < 1e-6, `x=${pos.x}`);
  assert.ok(Math.abs(pos.y - 300) < 1e-6);
  // heading north from mid-corridor (no junction here) can't leave the corridor
  const p2 = advanceStep(idx, pos, 0, 0.7, 11);
  assert.ok(Math.abs(p2.y - 300) < 1e-6);
});

test('PDR respects northOffsetDeg', () => {
  const rotated = indexBuilding({ ...building, northOffsetDeg: 90 }); // plan "up" is east
  const pos: Position = { floor: 'f1', x: 300, y: 300, source: 'qr', timestamp: 0 };
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

test('parseAnchor', () => {
  assert.deepEqual(parseAnchor('cnav:f1_j2'), { at: 'f1_j2' });
  assert.deepEqual(parseAnchor('https://x.app/?at=f1_j2&to=f2_r_c'), { at: 'f1_j2', to: 'f2_r_c' });
  assert.deepEqual(parseAnchor('f1_j2'), { at: 'f1_j2' });
  assert.equal(parseAnchor('https://example.com/'), null);
  assert.equal(parseAnchor(''), null);
});
