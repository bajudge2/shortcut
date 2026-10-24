import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { nearestLandmark, sourceLabel, destinationGroups } from '../src/lib/guidance.ts';
import { nodeLabel } from '../src/lib/graph.ts';
import type { Building, GraphNode } from '../src/lib/types.ts';

const realBuilding = JSON.parse(readFileSync(new URL('../src/data/building.json', import.meta.url), 'utf8')) as Building;

/** Small synthetic building: two floors, f2 has no nodes. */
function fixture(nodes: GraphNode[]): Building {
  return {
    id: 'test',
    name: 'Test',
    metersPerUnit: 0.1,
    northOffsetDeg: 0,
    floors: [
      { id: 'f1', label: 'Floor 1', level: 1, width: 100, height: 100 },
      { id: 'f2', label: 'Floor 2', level: 2, width: 100, height: 100 },
    ],
    nodes,
    edges: [],
    beacons: [],
  };
}

// Validates: Requirements 5.1
test('nearestLandmark: picks the nearest named node, skipping closer unnamed nodes', () => {
  const b = fixture([
    { id: 'j', floor: 'f1', x: 11, y: 10, kind: 'junction' },
    { id: 'far', floor: 'f1', x: 50, y: 50, kind: 'room', name: 'Far Room' },
    { id: 'near', floor: 'f1', x: 20, y: 10, kind: 'room', name: 'Near Room' },
    { id: 'blank', floor: 'f1', x: 12, y: 10, kind: 'room', name: '   ' }, // whitespace name is not "named"
  ]);
  const lm = nearestLandmark(b, 'f1', 10, 10)!;
  assert.equal(lm.node.id, 'near');
  assert.equal(lm.label, 'Near Room');
});

// Validates: Requirements 5.1
test('nearestLandmark: equal distance -> first named node in building.json order', () => {
  const nodes: GraphNode[] = [
    { id: 'a', floor: 'f1', x: 0, y: 10, kind: 'room', name: 'Alpha' },
    { id: 'b', floor: 'f1', x: 20, y: 10, kind: 'room', name: 'Bravo' },
  ];
  assert.equal(nearestLandmark(fixture(nodes), 'f1', 10, 10)!.node.id, 'a');
  assert.equal(nearestLandmark(fixture([...nodes].reverse()), 'f1', 10, 10)!.node.id, 'b');
});

// Validates: Requirements 5.1
test('nearestLandmark: ignores named nodes on other floors', () => {
  const b = fixture([
    { id: 'up', floor: 'f2', x: 10, y: 10, kind: 'room', name: 'Upstairs' },
    { id: 'here', floor: 'f1', x: 90, y: 90, kind: 'room', name: 'Here' },
  ]);
  assert.equal(nearestLandmark(b, 'f1', 10, 10)!.node.id, 'here');
});

// Validates: Requirements 5.2
test('nearestLandmark: no named node on floor -> nearest node with its nodeLabel', () => {
  const b = fixture([
    { id: 'st', floor: 'f1', x: 50, y: 50, kind: 'stairs' },
    { id: 'jn', floor: 'f1', x: 12, y: 10, kind: 'junction' },
    { id: 'other', floor: 'f2', x: 10, y: 10, kind: 'room', name: 'Upstairs' },
  ]);
  const lm = nearestLandmark(b, 'f1', 10, 10)!;
  assert.equal(lm.node.id, 'jn');
  assert.equal(lm.label, nodeLabel(lm.node));
  assert.equal(lm.label, 'the intersection');
});

// Validates: Requirements 5.2
test('nearestLandmark: fallback uses the same tie-break by building.json order', () => {
  const b = fixture([
    { id: 'el', floor: 'f1', x: 0, y: 10, kind: 'elevator' },
    { id: 'st', floor: 'f1', x: 20, y: 10, kind: 'stairs' },
  ]);
  assert.equal(nearestLandmark(b, 'f1', 10, 10)!.label, 'the elevator');
});

// Validates: Requirements 5.10
test('nearestLandmark: floor with no nodes returns null', () => {
  const b = fixture([{ id: 'x', floor: 'f1', x: 10, y: 10, kind: 'room', name: 'X' }]);
  assert.equal(nearestLandmark(b, 'f2', 10, 10), null);
  assert.equal(nearestLandmark(b, 'missing', 10, 10), null);
});

// Validates: Requirements 5.1
test('nearestLandmark on real building.json: near f1_junction_4 -> Crossroads Cafe', () => {
  const j = realBuilding.nodes.find((n) => n.id === 'f1_junction_4')!;
  assert.ok(j, 'f1_junction_4 exists');
  const lm = nearestLandmark(realBuilding, j.floor, j.x, j.y)!;
  assert.equal(lm.label, 'Crossroads Cafe');
});

// Validates: Requirements 5.3
test('sourceLabel for all four sources', () => {
  assert.equal(sourceLabel('ble'), 'Bluetooth');
  assert.equal(sourceLabel('manual'), "I'm here");
  assert.equal(sourceLabel('pdr'), 'Steps');
  assert.equal(sourceLabel('sim'), 'Teleport');
});

// Validates: Requirements 7.4
test('destinationGroups on real building.json: one "Floor 1" group, named nodes sorted A to Z', () => {
  const groups = destinationGroups(realBuilding);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].floor.label, 'Floor 1');
  const names = groups[0].nodes.map((n) => n.name!);
  const expected = realBuilding.nodes
    .filter((n) => n.floor === groups[0].floor.id && n.name && n.name.trim())
    .map((n) => n.name!);
  assert.deepEqual([...names].sort(), [...expected].sort(), 'every named node appears once');
  for (let i = 1; i < names.length; i++) {
    assert.ok(names[i - 1].toLowerCase() <= names[i].toLowerCase(), `${names[i - 1]} before ${names[i]}`);
  }
  assert.equal(names[0], 'Arena Entrance');
});
