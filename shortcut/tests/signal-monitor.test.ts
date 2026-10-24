import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SignalMonitor } from '../src/lib/signal-monitor.ts';
import { SIGNAL_QUIET_THRESHOLD_MS } from '../src/config.ts';

const T0 = 1_000;

/** Monitor with scanning turned on at T0 (Quiet_Period starts at T0). */
function scanningMonitor(thresholdMs?: number): SignalMonitor {
  const m = new SignalMonitor(thresholdMs);
  m.setScanning(true, T0);
  return m;
}

test('1.2, 1.8: default threshold is 15000 ms; lost at t0+15000, not at t0+14999', () => {
  assert.equal(SIGNAL_QUIET_THRESHOLD_MS, 15_000);
  const m = scanningMonitor();
  assert.equal(m.isLost(T0 + 14_999), false);
  assert.equal(m.isLost(T0 + 15_000), true);
});

test('1.2: custom threshold via constructor; RangeError on non-finite or non-positive', () => {
  const m = scanningMonitor(500);
  assert.equal(m.isLost(T0 + 499), false);
  assert.equal(m.isLost(T0 + 500), true);
  for (const bad of [0, -1, NaN, Infinity, -Infinity]) {
    assert.throws(() => new SignalMonitor(bad), RangeError, String(bad));
  }
});

test('1.3, 1.4: scanning off reports not lost and ignores beacon, anchor, dismiss inputs', () => {
  const m = new SignalMonitor();
  const before = m.state;
  m.report(null, T0);
  m.report('b1', T0 + 1);
  m.manualAnchor(T0 + 2);
  m.dismiss(T0 + 3);
  assert.equal(m.state, before, 'state object unchanged');
  for (const t of [T0, T0 + 15_000, T0 + 1_000_000]) assert.equal(m.isLost(t), false);
});

test('1.5: repeated turn-on while scanning keeps the original quiet start', () => {
  const m = scanningMonitor();
  m.setScanning(true, T0 + 10_000);
  assert.equal(m.state.quietStart, T0);
  assert.equal(m.isLost(T0 + 15_000), true);
});

test('1.6: a non-null beacon clears lost and suppression and ends the quiet period', () => {
  const m = scanningMonitor();
  assert.equal(m.isLost(T0 + 20_000), true);
  m.dismiss(T0 + 20_001);
  assert.equal(m.state.suppressed, true);
  m.report('b1', T0 + 20_002);
  assert.equal(m.state.suppressed, false);
  assert.equal(m.state.quietStart, null);
  assert.equal(m.isLost(T0 + 20_002), false);
  // With no quiet period in progress, the flag stays false indefinitely.
  assert.equal(m.isLost(T0 + 100_000), false);
});

test('1.7: first null starts the quiet period; repeated nulls keep its start', () => {
  const m = scanningMonitor();
  m.report('b1', T0);
  const q = T0 + 100;
  m.report(null, q);
  for (let i = 1; i <= 10; i++) m.report(null, q + i * 1_000);
  assert.equal(m.state.quietStart, q);
  assert.equal(m.isLost(q + 14_999), false);
  assert.equal(m.isLost(q + 15_000), true);
});

for (const [crit, act] of [
  ['1.9', (m: SignalMonitor, t: number) => m.manualAnchor(t)],
  ['1.10', (m: SignalMonitor, t: number) => m.dismiss(t)],
] as const) {
  test(`${crit}: suppression survives 100 null reports until a beacon and a new full quiet period`, () => {
    const m = scanningMonitor();
    assert.equal(m.isLost(T0 + 15_000), true);
    act(m, T0 + 15_000);
    assert.equal(m.isLost(T0 + 15_000), false);
    let t = T0 + 15_000;
    for (let i = 0; i < 100; i++) {
      t += 1_000;
      m.report(null, t);
      assert.equal(m.isLost(t), false);
    }
    // Recovery: non-null beacon, then a new quiet period reaching the threshold.
    m.report('b1', t + 1);
    m.report(null, t + 2);
    assert.equal(m.isLost(t + 2 + 14_999), false);
    assert.equal(m.isLost(t + 2 + 15_000), true);
  });
}

test('1.11: scanning off then on starts fresh (no old quiet period, no suppression)', () => {
  const m = scanningMonitor();
  m.manualAnchor(T0 + 1);
  m.setScanning(false, T0 + 2);
  assert.equal(m.isLost(T0 + 2), false);
  assert.equal(m.state.quietStart, null);
  assert.equal(m.state.suppressed, false);
  const t1 = T0 + 50_000;
  m.setScanning(true, t1);
  assert.equal(m.state.quietStart, t1);
  assert.equal(m.isLost(t1 + 14_999), false);
  assert.equal(m.isLost(t1 + 15_000), true);
});

test('1.12: stale inputs and queries are ignored and answered as of the latest timestamp', () => {
  const m = scanningMonitor();
  assert.equal(m.isLost(T0 + 15_000), true);
  const before = m.state;
  m.report('b1', T0 + 5_000); // stale: must not clear the lost flag
  m.manualAnchor(T0 + 5_000);
  m.dismiss(T0 + 5_000);
  m.setScanning(false, T0 + 5_000);
  assert.equal(m.state, before, 'state object unchanged');
  // A stale query reports the flag as of the latest accepted timestamp (T0+15000).
  assert.equal(m.isLost(T0 + 1), true);
  assert.equal(m.state, before);
});

test('1.13: no lost flag anywhere inside a full window after a beacon', () => {
  const m = scanningMonitor();
  const tb = T0 + 30_000;
  m.report('b1', tb);
  m.report(null, tb); // quiet period starts at the same instant
  for (let t = tb; t < tb + 15_000; t += 997) assert.equal(m.isLost(t), false, `t=${t}`);
  assert.equal(m.isLost(tb + 14_999), false);
});

test('1.14: two queries at the same timestamp return the same flag', () => {
  const m = scanningMonitor();
  for (const t of [T0 + 14_999, T0 + 15_000, T0 + 20_000]) {
    assert.equal(m.isLost(t), m.isLost(t), `t=${t}`);
  }
  m.dismiss(T0 + 20_000);
  assert.equal(m.isLost(T0 + 20_000), m.isLost(T0 + 20_000));
});

test('1.1, 8.2: signal-monitor.ts reads no clocks, timers, or browser globals; only imports ../config.ts', () => {
  const src = readFileSync(new URL('../src/lib/signal-monitor.ts', import.meta.url), 'utf8');
  // Strip comments so documentation prose cannot trip the scan.
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  for (const id of ['window', 'document', 'navigator', 'setTimeout', 'setInterval']) {
    assert.ok(!new RegExp(`\\b${id}\\b`).test(code), `forbidden identifier: ${id}`);
  }
  assert.ok(!/Date\s*\.\s*now/.test(code), 'forbidden: Date.now');
  const imports = [...code.matchAll(/\bfrom\s+['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]|\bimport\s+['"]([^'"]+)['"]/g)]
    .map((mt) => mt[1] ?? mt[2] ?? mt[3]);
  assert.deepEqual(imports, ['../config.ts']);
});
