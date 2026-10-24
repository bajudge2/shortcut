import { useEffect, useMemo, useRef, useState } from 'react';
import * as L from 'leaflet';
import type { Building, Position } from '../lib/types.ts';
import { newAnchorNodeId } from '../lib/anchor.ts';
import { focusLayers, routeKey } from '../lib/focus-layers.ts';
import { followView, type PlanRect } from '../lib/follow-view.ts';
import {
  INITIAL_FOLLOW_MODE, showRecenter, stepFollow, viewCommand,
  type FollowEvent, type FollowMode,
} from '../lib/follow-state.ts';
import RecenterButton from './RecenterButton.tsx';

interface Props {
  building: Building;
  floorId: string;
  position: Position | null;
  routeNodes: string[];
  destinationId: string;
  onMapTap?: (floor: string, x: number, y: number) => void;
  /** When true, the destination ring renders in the arrival color. */
  destinationArrived?: boolean;
}

// Plan coords (x right, y down) -> Leaflet CRS.Simple (lng = x, lat = -y)
const ll = (x: number, y: number) => L.latLng(-y, x);
const rectToBounds = (r: PlanRect) => L.latLngBounds(ll(r.minX, r.maxY), ll(r.maxX, r.minY));
const prefersReducedMotion = () =>
  typeof window !== 'undefined' && (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);

/**
 * Decluttered map: the floor plan as the base layer, plus only the route, the
 * destination, and the user. While a route is active it follows the user;
 * a manual pan/zoom pauses following until Recenter is tapped.
 */
export default function MapView({ building, floorId, position, routeNodes, destinationId, onMapTap, destinationArrived }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const baseLayer = useRef<L.LayerGroup | null>(null);
  const focusLayer = useRef<L.LayerGroup | null>(null);
  const youMarker = useRef<L.Marker | null>(null);
  const prevPos = useRef<Position | null>(null);
  const viewPrev = useRef<{ floorId: string; destinationId: string; position: Position | null } | null>(null);
  const programmatic = useRef(false);
  const cbs = useRef({ onMapTap, floorId });
  cbs.current = { onMapTap, floorId };

  const [mode, setMode] = useState<FollowMode>(INITIAL_FOLLOW_MODE);
  const rKey = routeKey(routeNodes);
  // rKey stands in for routeNodes so a new-but-equal array doesn't recompute
  const follow = useMemo(() => followView(building, floorId, position, routeNodes), [building, floorId, position, rKey]);

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
    const base = map.createPane('base');
    base.style.zIndex = '250';
    base.style.pointerEvents = 'none';
    baseLayer.current = L.layerGroup().addTo(map);
    focusLayer.current = L.layerGroup().addTo(map);
    const you = map.createPane('you');
    you.style.zIndex = '640';
    you.style.pointerEvents = 'none';

    // User pan/zoom pauses following; our own fitBounds/panTo set `programmatic` first.
    const pause = () => setMode((m) => stepFollow(m, 'userMove'));
    map.on('movestart', () => { if (!programmatic.current) pause(); });
    map.on('dragstart', pause); // Leaflet fires this only for user drags
    map.on('moveend', () => { programmatic.current = false; });
    map.on('click', (e: L.LeafletMouseEvent) => cbs.current.onMapTap?.(cbs.current.floorId, e.latlng.lng, -e.latlng.lat));

    mapRef.current = map;
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(el.current);
    return () => {
      ro.disconnect();
      youMarker.current?.remove();
      youMarker.current = null;
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // base layer: the floor plan image, or a plain outline if there is none / it fails to load
  useEffect(() => {
    const map = mapRef.current;
    const layer = baseLayer.current;
    const floor = building.floors.find((f) => f.id === floorId);
    if (!map || !layer || !floor) return;
    layer.clearLayers();
    const bounds = L.latLngBounds(ll(0, floor.height), ll(floor.width, 0));
    const outline = () => L.rectangle(bounds, {
      pane: 'base', color: '#cbd5e1', weight: 1, fillColor: '#f8fafc', fillOpacity: 1, interactive: false,
    });
    if (floor.image) {
      const img = L.imageOverlay(floor.image, bounds, { pane: 'base', opacity: 1, interactive: false });
      img.once('error', () => {
        if (cbs.current.floorId !== floor.id) return; // user switched floors meanwhile
        layer.removeLayer(img);
        outline().addTo(layer);
      });
      img.addTo(layer);
    } else {
      outline().addTo(layer);
    }
  }, [building, floorId]);

  // overlays: route line, start dot, destination ring + label
  useEffect(() => {
    const layer = focusLayer.current;
    if (!layer) return;
    const f = focusLayers(building, floorId, position, routeNodes, destinationId);
    layer.clearLayers();
    for (const seg of f.segments) {
      const pts = seg.map((p) => ll(p.x, p.y));
      L.polyline(pts, { color: '#ffffff', weight: 10, opacity: 0.9, lineCap: 'round', lineJoin: 'round', interactive: false }).addTo(layer);
      L.polyline(pts, { color: '#dc2626', weight: 6, opacity: 1, lineCap: 'round', lineJoin: 'round', interactive: false, className: 'route-line' }).addTo(layer);
    }
    if (f.start) {
      L.circleMarker(ll(f.start.x, f.start.y), {
        radius: 6, color: '#dc2626', weight: 3, fillColor: '#ffffff', fillOpacity: 1, interactive: false, className: 'start-dot',
      }).addTo(layer);
    }
    if (f.destination) {
      L.circleMarker(ll(f.destination.x, f.destination.y), {
        radius: 15, color: '#ef4444', weight: 3, fillOpacity: 0, interactive: false,
        className: destinationArrived ? 'dest-ring arrived' : 'dest-ring',
      })
        .bindTooltip(f.destination.label, { permanent: true, direction: 'top', offset: [0, -16], className: 'dest-label' })
        .addTo(layer);
    }
    // position is deliberately not a dependency: the overlays only depend on the route
  }, [building, floorId, rKey, destinationId, destinationArrived]);

  // view: follow the user, fit the plan, or reveal a new anchor (exactly one per change)
  useEffect(() => {
    const map = mapRef.current;
    const floor = building.floors.find((fl) => fl.id === floorId);
    if (!map || !floor) return;
    const prev = viewPrev.current;
    viewPrev.current = { floorId, destinationId, position };
    const floorChanged = prev === null || prev.floorId !== floorId;
    const anchor = position?.floor === floorId && newAnchorNodeId(prev?.position ?? null, position) !== null;

    const events: FollowEvent[] = [];
    if (prev !== null && prev.floorId !== floorId) events.push('floorChange');
    if (prev !== null && prev.destinationId !== destinationId) events.push('destChange');
    if (anchor) events.push('newAnchor');
    const next = events.reduce(stepFollow, mode);
    if (next !== mode) setMode(next);

    const cmd = viewCommand(next, follow, floorChanged, anchor);
    const animate = !prefersReducedMotion();
    const move = (fn: () => void) => { programmatic.current = true; fn(); };
    const planBounds = L.latLngBounds(ll(0, floor.height), ll(floor.width, 0));
    switch (cmd.kind) {
      case 'follow':
        move(() => map.fitBounds(rectToBounds(cmd.rect), { padding: [24, 24], maxZoom: map.getMaxZoom(), animate }));
        break;
      case 'plan':
        move(() => map.fitBounds(planBounds, { padding: [10, 10], animate }));
        break;
      case 'reveal': {
        const p = ll(position!.x, position!.y);
        if (!map.getBounds().contains(p)) move(() => map.panTo(p, { animate }));
        break;
      }
      case 'none':
        break;
    }
  }, [building, floorId, position, rKey, destinationId, mode, follow]);

  // "you are here": one persistent divIcon marker in the top `you` pane
  useEffect(() => {
    const map = mapRef.current;
    const prev = prevPos.current;
    prevPos.current = position;
    if (!map) return;
    if (!position || position.floor !== floorId) {
      youMarker.current?.remove();
      return;
    }
    const p = ll(position.x, position.y);
    let marker = youMarker.current;
    if (!marker) {
      marker = L.marker(p, {
        icon: L.divIcon({
          className: 'you-marker',
          html: '<span class="you-halo"></span><span class="you-dot"></span>',
          iconSize: [36, 36],
        }),
        pane: 'you',
        interactive: false,
        keyboard: false,
      });
      youMarker.current = marker;
    } else {
      marker.setLatLng(p);
    }
    if (!map.hasLayer(marker)) marker.addTo(map);

    // Pulse once when a new manual/Bluetooth anchor was just set
    if (newAnchorNodeId(prev, position) !== null) {
      const icon = marker.getElement();
      if (icon) {
        icon.classList.remove('pulse');
        void icon.offsetWidth; // force reflow so the animation restarts
        icon.classList.add('pulse');
        icon.addEventListener('animationend', () => icon.classList.remove('pulse'), { once: true });
      }
    }
  }, [position, floorId]);

  return (
    <>
      <div ref={el} className="map" />
      {showRecenter(mode, follow) && (
        <RecenterButton onRecenter={() => setMode((m) => stepFollow(m, 'recenter'))} />
      )}
    </>
  );
}
