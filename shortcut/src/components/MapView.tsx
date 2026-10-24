import { useEffect, useRef } from 'react';
import * as L from 'leaflet';
import type { Building, GraphNode, NodeKind, Position } from '../lib/types.ts';

interface Props {
  building: Building;
  floorId: string;
  position: Position | null;
  routeNodes: string[];
  destinationId: string;
  onNodeTap: (nodeId: string) => void;
  onMapTap?: (floor: string, x: number, y: number) => void;
}

// Plan coords (x right, y down) -> Leaflet CRS.Simple (lng = x, lat = -y)
const ll = (x: number, y: number) => L.latLng(-y, x);

const KIND_COLOR: Record<NodeKind, string> = {
  junction: '#9aa3b2',
  room: '#2f6fed',
  stairs: '#e08a00',
  elevator: '#8a3ffc',
  entrance: '#16a34a',
  restroom: '#0891b2',
  other: '#6b7280',
};

export default function MapView({ building, floorId, position, routeNodes, destinationId, onNodeTap, onMapTap }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const staticLayer = useRef<L.LayerGroup | null>(null);
  const routeLayer = useRef<L.LayerGroup | null>(null);
  const userLayer = useRef<L.LayerGroup | null>(null);
  const userMarker = useRef<L.Marker | null>(null);
  const cbs = useRef({ onNodeTap, onMapTap, floorId });
  cbs.current = { onNodeTap, onMapTap, floorId };

  // create map once
  useEffect(() => {
    if (!el.current || mapRef.current) return;
    const map = L.map(el.current, {
      crs: L.CRS.Simple,
      minZoom: -3,
      maxZoom: 2,
      zoomSnap: 0.25,
      zoomControl: false,
      attributionControl: false,
    });
    staticLayer.current = L.layerGroup().addTo(map);
    routeLayer.current = L.layerGroup().addTo(map);
    userLayer.current = L.layerGroup().addTo(map);
    map.on('click', (e: L.LeafletMouseEvent) => cbs.current.onMapTap?.(cbs.current.floorId, e.latlng.lng, -e.latlng.lat));
    mapRef.current = map;
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(el.current);
    return () => { ro.disconnect(); map.remove(); mapRef.current = null; };
  }, []);

  // draw the floor (plan, corridors, nodes)
  useEffect(() => {
    const map = mapRef.current;
    const layer = staticLayer.current;
    const floor = building.floors.find((f) => f.id === floorId);
    if (!map || !layer || !floor) return;
    layer.clearLayers();
    const bounds = L.latLngBounds(ll(0, floor.height), ll(floor.width, 0));

    L.rectangle(bounds, { color: '#cbd5e1', weight: 1, fillColor: '#f8fafc', fillOpacity: 1, interactive: false }).addTo(layer);
    if (floor.image) L.imageOverlay(floor.image, bounds, { interactive: false }).addTo(layer);

    const byId = new Map(building.nodes.map((n) => [n.id, n]));
    for (const e of building.edges) {
      const a = byId.get(e.from)!;
      const b = byId.get(e.to)!;
      if (a.floor !== floorId || b.floor !== floorId) continue;
      L.polyline([ll(a.x, a.y), ll(b.x, b.y)], {
        color: floor.image ? '#94a3b8' : '#e2e8f0',
        weight: floor.image ? 3 : 18,
        opacity: floor.image ? 0.7 : 1,
        lineCap: 'round',
        interactive: false,
      }).addTo(layer);
    }
    for (const n of building.nodes as GraphNode[]) {
      if (n.floor !== floorId) continue;
      const m = L.circleMarker(ll(n.x, n.y), {
        radius: n.kind === 'junction' ? 4 : 8,
        color: '#ffffff',
        weight: 2,
        fillColor: KIND_COLOR[n.kind] ?? '#6b7280',
        fillOpacity: 1,
      }).addTo(layer);
      if (n.name) m.bindTooltip(n.name, { permanent: true, direction: 'top', offset: [0, -6], className: 'node-label' });
      m.on('click', (ev) => { L.DomEvent.stopPropagation(ev); cbs.current.onNodeTap(n.id); });
    }
    map.fitBounds(bounds, { padding: [10, 10] });
  }, [building, floorId]);

  // route + destination
  useEffect(() => {
    const layer = routeLayer.current;
    if (!layer) return;
    layer.clearLayers();
    const byId = new Map(building.nodes.map((n) => [n.id, n]));
    let run: L.LatLng[] = [];
    const flush = () => {
      if (run.length > 1) L.polyline(run, { color: '#ef4444', weight: 6, opacity: 0.9, dashArray: '2 10', lineCap: 'round', interactive: false }).addTo(layer);
      run = [];
    };
    for (const id of routeNodes) {
      const n = byId.get(id);
      if (!n) continue;
      if (n.floor === floorId) run.push(ll(n.x, n.y)); else flush();
    }
    flush();
    const dest = destinationId ? byId.get(destinationId) : undefined;
    if (dest && dest.floor === floorId) {
      L.circleMarker(ll(dest.x, dest.y), { radius: 15, color: '#ef4444', weight: 3, fillOpacity: 0, interactive: false }).addTo(layer);
    }
  }, [building, floorId, routeNodes, destinationId]);

  // "you are here"; retain one DOM marker so CSS can interpolate step updates.
  useEffect(() => {
    const layer = userLayer.current;
    const map = mapRef.current;
    if (!layer || !map) return;
    if (!position || position.floor !== floorId) {
      if (userMarker.current) layer.removeLayer(userMarker.current);
      userMarker.current = null;
      return;
    }
    const p = ll(position.x, position.y);
    if (!userMarker.current) {
      userMarker.current = L.marker(p, {
        interactive: false,
        icon: L.divIcon({
          className: 'user-marker',
          html: '<span class="user-marker-halo"></span><span class="user-marker-dot"></span>',
          iconSize: [36, 36],
          iconAnchor: [18, 18],
        }),
      }).addTo(layer);
    } else {
      userMarker.current.setLatLng(p);
    }
    if (!map.getBounds().contains(p)) map.panTo(p);
  }, [position, floorId]);

  return <div ref={el} className="map" />;
}
