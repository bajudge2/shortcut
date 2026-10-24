import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { findRoute, indexBuilding } from '../src/lib/graph.ts';
import { FOLLOW_MAX_EXTENT_M, FOLLOW_MIN_EXTENT_M, followView } from '../src/lib/follow-view.ts';
import { INITIAL_FOLLOW_MODE, showRecenter, stepFollow, viewCommand, type FollowEvent, type FollowMode } from '../src/lib/follow-state.ts';
import type { Building, Position } from '../src/lib/types.ts';

const real = JSON.parse(readFileSync(new URL('../src/data/building.json', import.meta.url), 'utf8')) as Building;
const realIdx = indexBuilding(real);
const pos = (x: number, y: number, floor = 'f1'): Position => ({ floor, x, y, source: 'pdr', timestamp: 0 });
const route = findRoute(realIdx, 'f1_junction_12', 'f1_junction_4')!.nodes;
const minU = FOLLOW_MIN_EXTENT_M / real.metersPerUnit; // 164.04 units
const maxU = FOLLOW_MAX_EXTENT_M / real.metersPerUnit; // 328.08 units

test('followView is null when following is impossible (6.8)', () => {
  const arena = realIdx.nodeById.get('f1_junction_12')!;
  assert.equal(followView(real, 'f1', pos(arena.x, arena.y), []), null);
  assert.equal(followView(real, 'f1', null, route), null);
  assert.equal(followView(real, 'f1', pos(arena.x, arena.y, 'ghost'), route), null);
  assert.equal(followView(real, 'ghost', pos(arena.x, arena.y, 'ghost'), route), null);
  assert.equal(followView({ ...real, metersPerUnit: 0 }, 'f1', pos(arena.x, arena.y), route), null);
});

test('followView from Arena Entrance: inside the plan, contains the user, 20–40 m (6.9, 6.10, 6.11)', () => {
  const arena = realIdx.nodeById.get('f1_junction_12')!;
  const v = followView(real, 'f1', pos(arena.x, arena.y), route)!;
  const { minX, minY, maxX, maxY } = v.rect;
  assert.ok(minX >= 0 && minY >= 0 && maxX <= 610 && maxY <= 888);
  assert.ok(arena.x >= minX && arena.x <= maxX && arena.y >= minY && arena.y <= maxY);
  assert.equal(v.nodeIds[0], 'f1_junction_12');
  for (const id of v.nodeIds) {
    const n = realIdx.nodeById.get(id)!;
    assert.ok(n.x >= minX && n.x <= maxX && n.y >= minY && n.y <= maxY, id);
  }
  for (const side of [maxX - minX, maxY - minY]) {
    assert.ok(side >= minU - 1e-9 && side <= maxU + 1e-9, `side=${side}`);
  }
});

test('followView at the plan corner shifts inside and keeps the minimum size (6.11, 6.12)', () => {
  const v = followView(real, 'f1', pos(0, 0), route)!;
  assert.equal(v.rect.minX, 0);
  assert.equal(v.rect.minY, 0);
  assert.ok(v.rect.maxX - v.rect.minX >= minU - 1e-9);
  assert.ok(v.rect.maxY - v.rect.minY >= minU - 1e-9);
});

test('followView is centered on the user away from plan edges (6.12)', () => {
  const v = followView(real, 'f1', pos(305, 444), ['nope'])!; // no upcoming nodes -> minimum box
  assert.deepEqual(v.center, { x: 305, y: 444 });
  assert.deepEqual(v.nodeIds, []);
});

test('followView on a plan smaller than the minimum uses the whole plan (6.11)', () => {
  const tiny: Building = { ...real, floors: [{ ...real.floors[0], width: 50, height: 50 }] };
  const v = followView(tiny, 'f1', pos(10, 10), ['nope'])!;
  assert.deepEqual(v.rect, { minX: 0, minY: 0, maxX: 50, maxY: 50 });
});

test('followView is deterministic and does not mutate inputs (6.13)', () => {
  const p = pos(300, 300);
  const pCopy = { ...p };
  const rCopy = [...route];
  assert.deepEqual(followView(real, 'f1', p, route), followView(real, 'f1', p, route));
  assert.deepEqual(p, pCopy);
  assert.deepEqual(route, rCopy);
});

test('follow state: initial mode, transitions, recenter, and view command (7.8–7.11)', () => {
  assert.equal(INITIAL_FOLLOW_MODE, 'following');
  const events: FollowEvent[] = ['userMove', 'recenter', 'destChange', 'floorChange', 'newAnchor'];
  for (const m of ['following', 'paused'] as FollowMode[]) {
    for (const e of events) assert.equal(stepFollow(m, e), e === 'userMove' ? 'paused' : 'following', `${m}+${e}`);
  }
  const v = followView(real, 'f1', pos(300, 300), route);
  assert.equal(showRecenter('paused', v), true);
  assert.equal(showRecenter('paused', null), false);
  assert.equal(showRecenter('following', v), false);
  assert.equal(showRecenter('following', null), false);

  assert.deepEqual(viewCommand('following', v, true, true), { kind: 'follow', rect: v!.rect });
  assert.deepEqual(viewCommand('following', null, true, true), { kind: 'plan' });
  assert.deepEqual(viewCommand('paused', v, false, true), { kind: 'reveal' });
  assert.deepEqual(viewCommand('paused', v, false, false), { kind: 'none' });
});
