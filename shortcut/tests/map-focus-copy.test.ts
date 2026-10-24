import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const src = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');

test('focus/follow modules are pure (3.1, 6.14, 7.12, 9.3)', () => {
  for (const f of ['lib/focus-layers.ts', 'lib/follow-view.ts', 'lib/follow-state.ts']) {
    const code = src(f);
    for (const m of code.matchAll(/from '([^']+)'/g)) assert.ok(m[1].startsWith('./'), `${f} imports ${m[1]}`);
    assert.doesNotMatch(code, /\b(react|leaflet|@capacitor|window|document)\b/, f);
  }
});

test('MapView draws only the plan and focus layers (1.6, 2.1–2.3, 5.1, 6.3, 6.7)', () => {
  const mv = src('components/MapView.tsx');
  assert.doesNotMatch(mv, /onNodeTap/);
  assert.doesNotMatch(mv, /building\.edges/);
  assert.equal(mv.match(/bindTooltip/g)?.length, 1);
  assert.match(mv, /createPane\('base'\)/);
  assert.match(mv, /prefers-reduced-motion/);
  assert.match(mv, /RecenterButton/);
  assert.doesNotMatch(mv, /setBearing|rotate/);
});

test('App has the "I’m at" picker before the destination picker and no node sheet (4.1, 5.1, 8.4)', () => {
  const app = src('App.tsx');
  assert.doesNotMatch(app, /sheetNode|sheet-backdrop/);
  assert.match(app, /aria-label="Destination"/);
  const picker = app.indexOf('<LocationPicker');
  assert.ok(picker > 0 && picker < app.indexOf('aria-label="Destination"'));
});

test('LocationPicker and RecenterButton are accessible and read-only (4.9, 8.1, 8.6, 9.4)', () => {
  const lp = src('components/LocationPicker.tsx');
  assert.match(lp, /aria-label="Current location"/);
  assert.match(lp, /I’m at…/);
  assert.doesNotMatch(lp, /disabled|setAnchor|setPoint|engine/);
  const rb = src('components/RecenterButton.tsx');
  assert.match(rb, /aria-label="Recenter on my location"/);
  assert.match(rb, /Recenter/);
  assert.match(rb, /<button/);
});

test('hints point at visible controls, never at tapping the map (5.5–5.9)', () => {
  const rg = src('components/RouteGuidance.tsx');
  assert.match(rg, /Turn on Bluetooth, or choose where you are from “I’m at”\./);
  assert.match(rg, /Choose where you are from “I’m at”\./);
  assert.match(rg, /Choose a destination from “Where to\?”\./);
  const rb = src('components/RelocateBanner.tsx');
  assert.match(rb, /Choose where you are from “I’m at” at the top of the screen\./);
  assert.match(rb, /Bluetooth signal lost\. Choose where you are from I’m at at the top of the screen\./);

  const files = ['App.tsx', ...readdirSync(new URL('../src/components/', import.meta.url)).map((f) => `components/${f}`)];
  for (const f of files) {
    const code = src(f).replace(/Tap map to teleport/g, '');
    assert.doesNotMatch(code, /tap (the|a place|a room|where)/i, f);
    assert.doesNotMatch(code, /Navigate here/, f);
    assert.doesNotMatch(code, /choose “I’m here”/, f);
  }
});
