export type NodeKind = 'junction' | 'room' | 'stairs' | 'elevator' | 'entrance' | 'restroom' | 'other';
export type EdgeType = 'corridor' | 'stairs' | 'elevator';
export type PositionSource = 'qr' | 'manual' | 'ble' | 'pdr' | 'sim';

export interface Floor {
  id: string;
  label: string;
  level: number;
  /** plan size in plan units (same units as node x/y). y grows downward like an image. */
  width: number;
  height: number;
  /** optional floor plan image path (e.g. /plans/f1.png) drawn behind the graph */
  image?: string;
}

export interface GraphNode {
  id: string;
  floor: string;
  x: number;
  y: number;
  kind: NodeKind;
  name?: string;
}

export interface GraphEdge {
  from: string;
  to: string;
  type?: EdgeType;
}

export interface BeaconDef {
  /** short id advertised by the ESP32, e.g. "B1" -> BLE local name "CNAV-B1" */
  id: string;
  /** graph node where this beacon is physically mounted */
  node: string;
}

export interface Building {
  id: string;
  name: string;
  /** meters represented by one plan unit */
  metersPerUnit: number;
  /** degrees clockwise from true north to the "up" direction of the plan. 0 = plan up is north. */
  northOffsetDeg: number;
  floors: Floor[];
  nodes: GraphNode[];
  edges: GraphEdge[];
  beacons: BeaconDef[];
}

export interface Position {
  floor: string;
  x: number;
  y: number;
  /** set when the position is exactly on a node (QR / BLE / manual) */
  nodeId?: string;
  source: PositionSource;
  timestamp: number;
}

export interface Route {
  nodes: string[];
  distanceMeters: number;
}

export interface DirectionStep {
  text: string;
  distanceMeters: number;
  /** node id where this step begins */
  nodeId: string;
}
