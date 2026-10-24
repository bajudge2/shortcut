import { useEffect, useMemo, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import buildingJson from './data/building.json';
import { BEACON_NAME_PREFIX, BEACON_SERVICE_UUID, STEP_LENGTH_M } from './config.ts';
import { describeRoute, destinations, findRoute, nearestNode, nodeLabel } from './lib/graph.ts';
import { parseDeepLink } from './lib/deeplink.ts';
import type { Building, Position } from './lib/types.ts';
import { PositionEngine, type NavigationState } from './positioning/engine.ts';
import { BleLocator, type BeaconSnapshot } from './positioning/ble.ts';
import { MotionSensors } from './positioning/motion.ts';
import MapView from './components/MapView.tsx';

const building = buildingJson as unknown as Building;
const engine = new PositionEngine(building, STEP_LENGTH_M);
const ble = new BleLocator(BEACON_SERVICE_UUID, BEACON_NAME_PREFIX);
const motion = new MotionSensors();
const DEST_KEY = 'cnav:dest';
const isNative = Capacitor.isNativePlatform();

export default function App() {
  const [pos, setPos] = useState<Position | null>(engine.position);
  const [navigation, setNavigation] = useState<NavigationState>(engine.navigation);
  const [dest, setDest] = useState<string>(() => localStorage.getItem(DEST_KEY) ?? '');
  const [accessible, setAccessible] = useState(false);
  const [viewFloor, setViewFloor] = useState<string>(engine.position?.floor ?? building.floors[0].id);
  const [sheetNode, setSheetNode] = useState<string | null>(null);
  const [bleOn, setBleOn] = useState(false);
  const [stepsOn, setStepsOn] = useState(false);
  const [debug, setDebug] = useState(false);
  const [teleport, setTeleport] = useState(false);
  const [beacons, setBeacons] = useState<BeaconSnapshot[]>([]);
  const [stepCount, setStepCount] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const lastFloor = useRef<string | null>(engine.position?.floor ?? null);

  const flash = (msg: string) => { setToast(msg); window.setTimeout(() => setToast(null), 3500); };

  // follow the engine; switch the viewed floor when the user changes floors
  useEffect(() => engine.subscribe((p) => {
    setPos(p);
    if (p && p.floor !== lastFloor.current) setViewFloor(p.floor);
    lastFloor.current = p?.floor ?? null;
  }), []);

  useEffect(() => engine.subscribeNavigation(setNavigation), []);

  // deep links: ?at=<node>&to=<node>
  useEffect(() => {
    const a = parseDeepLink(window.location.href);
    if (!a) return;
    if (a.at && !engine.setAnchor(a.at, 'manual')) flash(`Unknown location "${a.at}"`);
    if (a.to && building.nodes.some((n) => n.id === a.to)) setDest(a.to);
    window.history.replaceState({}, '', window.location.pathname);
  }, []);

  useEffect(() => { localStorage.setItem(DEST_KEY, dest); }, [dest]);

  const fromId = useMemo(() => {
    if (!pos) return null;
    return pos.nodeId ?? nearestNode(engine.idx, pos.floor, pos.x, pos.y)?.id ?? null;
  }, [pos]);

  const route = useMemo(
    () => (fromId && dest ? findRoute(engine.idx, fromId, dest, { accessible }) : null),
    [fromId, dest, accessible],
  );
  const steps = useMemo(() => (route ? describeRoute(engine.idx, route) : []), [route]);
  useEffect(() => engine.setRoute(route?.nodes ?? []), [route]);
  const arrived = !!dest && fromId === dest;
  const noRoute = !!fromId && !!dest && !route;
  const destNode = dest ? engine.idx.nodeById.get(dest) : undefined;
  const dests = useMemo(() => destinations(building), []);

  const toggleBle = async () => {
    if (bleOn) { await ble.stop(); setBleOn(false); setBeacons([]); return; }
    if (!isNative) return flash('Bluetooth scanning only works in the iOS app build, not in Safari.');
    try {
      await ble.start({ onBeacon: (beacon) => engine.onBeacon(beacon), onSnapshot: setBeacons });
      setBleOn(true);
    } catch (e) { flash(`Bluetooth: ${e instanceof Error ? e.message : String(e)}`); }
  };

  // must run directly inside the tap handler (iOS motion permission needs a user gesture)
  const toggleSteps = async () => {
    if (stepsOn) { motion.stop(); setStepsOn(false); return; }
    try {
      await motion.start((observation) => { engine.onStep(observation); setStepCount(motion.steps); });
      setStepsOn(true);
    } catch (e) { flash(e instanceof Error ? e.message : String(e)); }
  };

  const sheetNodeObj = sheetNode ? engine.idx.nodeById.get(sheetNode) : undefined;

  return (
    <div className="app">
      <header className="top">
        <select value={dest} onChange={(e) => setDest(e.target.value)} aria-label="Destination">
          <option value="">Where to?</option>
          {building.floors.map((f) => (
            <optgroup key={f.id} label={f.label}>
              {dests.filter((n) => n.floor === f.id).map((n) => (
                <option key={n.id} value={n.id}>{n.name}</option>
              ))}
            </optgroup>
          ))}
        </select>
        {dest && <button className="ghost" onClick={() => setDest('')}>✕</button>}
      </header>

      <div className="map-wrap">
        <MapView
          building={building}
          floorId={viewFloor}
          position={pos}
          routeNodes={route?.nodes ?? []}
          destinationId={dest}
          onNodeTap={setSheetNode}
          onMapTap={teleport ? (f, x, y) => engine.setPoint(f, x, y) : undefined}
        />
        <div className="floors">
          {building.floors.map((f) => (
            <button key={f.id} className={f.id === viewFloor ? 'on' : ''} onClick={() => setViewFloor(f.id)}>
              {f.level}
            </button>
          ))}
        </div>
        {toast && <div className="toast">{toast}</div>}
      </div>

      <section className="panel">
        {!pos && <p className="hint">Turn on Bluetooth, or tap a place on the map and choose “I’m here”.</p>}
        {pos && !dest && <p className="hint">Choose a destination above.</p>}
        {navigation.wrongWay && <p className="wrong-way">↩️ You may be going the wrong way. Turn around and follow the route.</p>}
        {arrived && <p className="arrived">🎉 You’ve arrived at {destNode ? nodeLabel(destNode) : 'your destination'}</p>}
        {noRoute && <p className="warn">No route found{accessible ? ' (try turning off accessible routing)' : ''}.</p>}
        {route && !arrived && (
          <>
            <p className="summary">{Math.round(route.distanceMeters)} m · ~{Math.max(1, Math.round(route.distanceMeters / 80))} min</p>
            <ol className="steps">
              {steps.map((s, i) => (
                <li key={i} className={i === 0 ? 'now' : ''}>
                  {s.text}{s.distanceMeters > 0 ? ` — ${s.distanceMeters} m` : ''}
                </li>
              ))}
            </ol>
          </>
        )}

        <div className="controls">
          <button className={bleOn ? 'on' : ''} onClick={toggleBle}>📡 Bluetooth {bleOn ? 'on' : 'off'}</button>
          <button className={stepsOn ? 'on' : ''} onClick={toggleSteps}>👣 Steps {stepsOn ? 'on' : 'off'}</button>
          <label><input type="checkbox" checked={accessible} onChange={(e) => setAccessible(e.target.checked)} /> ♿ Accessible</label>
          <label><input type="checkbox" checked={debug} onChange={(e) => setDebug(e.target.checked)} /> Debug</label>
        </div>

        {debug && (
          <div className="debug">
            <div>Position: {pos ? `${pos.floor} (${Math.round(pos.x)}, ${Math.round(pos.y)}) via ${pos.source}${pos.nodeId ? ` @ ${pos.nodeId}` : ''}` : 'unknown'}</div>
            <div>Heading: {motion.currentHeading === null ? '—' : `${Math.round(motion.currentHeading)}° fused`} · steps: {stepCount}</div>
            <div>Route heading error: {navigation.headingErrorDeg === null ? '—' : `${Math.round(navigation.headingErrorDeg)}°`}{navigation.wrongWay ? ' · WRONG WAY' : ''}</div>
            <div>Beacons heard: {beacons.length === 0 ? 'none' : beacons.map((b) => `${b.id} ${Math.round(b.rssi)} dBm`).join(' · ')}</div>
            <label><input type="checkbox" checked={teleport} onChange={(e) => setTeleport(e.target.checked)} /> Tap map to teleport</label>
            <button className="ghost" onClick={() => engine.clear()}>Clear position</button>
          </div>
        )}
      </section>

      {sheetNodeObj && (
        <div className="sheet-backdrop" onClick={() => setSheetNode(null)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <h3>{nodeLabel(sheetNodeObj)}</h3>
            <button onClick={() => { setDest(sheetNodeObj.id); setSheetNode(null); }}>Navigate here</button>
            <button onClick={() => { engine.setAnchor(sheetNodeObj.id, 'manual'); setSheetNode(null); }}>I’m here</button>
            <button className="ghost" onClick={() => setSheetNode(null)}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
