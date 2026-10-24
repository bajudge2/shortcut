import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { findRoute, indexBuilding } from '../src/lib/graph.ts';
import { focusLayers, routeKey } from '../src/lib/focus-layers.ts';
import { destinationGroups, destinationName, locationPickerValue } from '../src/lib/guidance.ts';
import type { Building, Position } from '../src/lib/types.ts';

const real = JSON.parse(readFileSync(new URL('../src/data/building.json', import.meta.url), 'utf8')) as Building;
const realIdx = indexBuilding(real);
const at = (id: string): Position => {
  const n = realIdx.nodeById.get(id)!;
  return { floor: n.floor, x: n.x, y: n.y, nodeId: n.id, source: 'manual', timestamp: 0 };
};

test('focusLayers: one on-floor segment equal to the Route, start at the Route start (3.2, 3.3, 3.8)', () => {
  const route = findRoute(realIdx, 'f1_junction_12', 'f1_junction_4')!;
  const f = focusLayers(real, 'f1', at('f1_junction_12'), route.nodes, 'f1_junction_4');
  const coords = route.nodes.map((id) => ({ x: realIdx.nodeById.get(id)!.x, y: realIdx.nodeById.get(id)!.y }));
  assert.deepEqual(f.segments, [coords]);
  const s = realIdx.nodeById.get('f1_junction_12')!;
  assert.deepEqual(f.start, { nodeId: s.id, x: s.x, y: s.y });
});

test('focusLayers: a one-node Route has no segment (3.4)', () => {
  const f = focusLayers(real, 'f1', null, ['f1_junction_4'], '');
  assert.deepEqual(f.segments, []);
  assert.equal(f.start!.nodeId, 'f1_junction_4');
});

test('focusLayers: destination marker only for a known node on the floor (3.5, 3.6)', () => {
  assert.equal(focusLayers(real, 'f1', null, [], '').destination, null);
  assert.equal(focusLayers(real, 'f1', null, [], 'nope').destination, null);
  const cafe = realIdx.nodeById.get('f1_junction_4')!;
  assert.deepEqual(focusLayers(real, 'f1', null, [], 'f1_junction_4').destination,
    { nodeId: cafe.id, x: cafe.x, y: cafe.y, label: destinationName(cafe) });
  assert.equal(focusLayers(real, 'ghost', null, [], 'f1_junction_4').destination, null);
});

test('focusLayers: empty Route gives no segments and no start (3.7)', () => {
  const f = focusLayers(real, 'f1', at('f1_junction_4'), [], 'f1_junction_4');
  assert.deepEqual(f.segments, []);
  assert.equal(f.start, null);
});

test('focusLayers is deterministic and does not mutate inputs (3.9)', () => {
  const route = findRoute(realIdx, 'f1_junction_12', 'f1_junction_4')!.nodes;
  const copy = [...route];
  const a = focusLayers(real, 'f1', null, route, 'f1_junction_4');
  const b = focusLayers(real, 'f1', null, route, 'f1_junction_4');
  assert.deepEqual(a, b);
  assert.notEqual(a.segments, b.segments, 'fresh arrays each call');
  assert.deepEqual(route, copy);
});

test('focusLayers: a Route that leaves the floor and returns gives two segments (3.3)', () => {
  const b: Building = {
    id: 't', name: 't', metersPerUnit: 1, northOffsetDeg: 0,
    floors: [{ id: 'a', label: 'A', level: 1, width: 100, height: 100 }, { id: 'b', label: 'B', level: 2, width: 100, height: 100 }],
    nodes: [
      { id: 'a1', floor: 'a', x: 0, y: 0, kind: 'junction' },
      { id: 'a2', floor: 'a', x: 10, y: 0, kind: 'junction' },
      { id: 'b1', floor: 'b', x: 10, y: 0, kind: 'stairs' },
      { id: 'a3', floor: 'a', x: 20, y: 0, kind: 'junction' },
      { id: 'a4', floor: 'a', x: 30, y: 0, kind: 'junction' },
    ],
    edges: [], beacons: [],
  };
  const f = focusLayers(b, 'a', null, ['a1', 'a2', 'b1', 'a3', 'a4'], '');
  assert.deepEqual(f.segments, [[{ x: 0, y: 0 }, { x: 10, y: 0 }], [{ x: 20, y: 0 }, { x: 30, y: 0 }]]);
  // an unknown id also splits the line
  assert.equal(focusLayers(b, 'a', null, ['a1', 'a2', 'zzz', 'a3', 'a4'], '').segments.length, 2);
});

test('routeKey', () => {
  assert.equal(routeKey([]), '');
  assert.notEqual(routeKey(['a', 'b']), routeKey(['ab']));
  assert.equal(routeKey(['a', 'b']), routeKey(['a', 'b']));
});

test('locationPickerValue follows the Position\'s named place (4.6, 4.7)', () => {
  const groups = destinationGroups(real);
  assert.equal(locationPickerValue(groups, null), '');
  assert.equal(locationPickerValue(groups, { floor: 'f1', x: 1, y: 1, source: 'pdr', timestamp: 0 }), '');
  assert.equal(locationPickerValue(groups, { ...at('f1_junction_4'), nodeId: 'nope' }), '');
  assert.equal(locationPickerValue(groups, at('f1_junction_2')), '', 'junctions are not listed');
  assert.equal(locationPickerValue(groups, at('f1_junction_4')), 'f1_junction_4');
});
