import test from 'node:test';
import assert from 'node:assert/strict';
import { generateFleet, fitModel, simulateRemaining, stretch, quantile, planLimits, usedThrough, totals, runPool, dayOf, STRETCH_GRID, mulberry32 } from '../core/pool.js';

const R = runPool({ alpha: 0.1, sims: 1500 });

test('fleet is deterministic and non-negative', () => {
  const a = generateFleet({ seed: 5 }), b = generateFleet({ seed: 5 });
  assert.equal(a.lines.length, 36);
  assert.deepEqual(Array.from(a.lines[3].usage.slice(0, 20)), Array.from(b.lines[3].usage.slice(0, 20)));
  for (const L of a.lines) for (const v of L.usage) assert.ok(v >= 0);
});

test('level is robust to a single burst day', () => {
  const usage = new Float64Array(120).fill(10);
  const lines = [{ usage }];
  const base = fitModel(lines, 100)[0].level;
  usage[95] = 500;
  assert.ok(Math.abs(fitModel(lines, 100)[0].level - base) < 1e-9);
});

test('stretch keeps the median and widens the band', () => {
  const fleet = generateFleet({});
  const m = fitModel(fleet.lines, fleet.endDay);
  const sim = simulateRemaining(fleet.lines, m, fleet.endDay, dayOf(2026, 11, 30), { sims: 600, seed: 1 });
  const z = fleet.lines.map(() => 0);
  const a = totals(sim, z), b = totals(stretch(sim, 2), z);
  assert.ok(Math.abs(quantile(a, 0.5) - quantile(b, 0.5)) / quantile(a, 0.5) < 0.01);
  assert.ok(quantile(b, 0.9) - quantile(b, 0.1) > 1.5 * (quantile(a, 0.9) - quantile(a, 0.1)));
});

test('calibrated band covers at least 80% of past checkpoints and beats the raw model', () => {
  const bt = R.backtest;
  assert.equal(bt.n, 30);
  assert.ok(bt.coverage >= 24, `calibrated ${bt.coverage}`);
  assert.ok(bt.coverageRaw < bt.coverage);
  // nested bands: coverage never drops as k grows
  let prev = -1;
  for (const k of STRETCH_GRID) {
    const c = bt.rows.reduce((a, r) => { const lo = r.q50 * Math.pow(r.q10 / r.q50, k), hi = r.q50 * Math.pow(r.q90 / r.q50, k); return a + (r.actual >= lo && r.actual <= hi ? 1 : 0); }, 0);
    assert.ok(c >= prev); prev = c;
  }
});

test('forecast bands are ordered and cumulative', () => {
  let last = R.usedTotal;
  for (const b of R.cumBands) {
    assert.ok(b.q025 <= b.q10 && b.q10 <= b.q50 && b.q50 <= b.q90 && b.q90 <= b.q975);
    assert.ok(b.q50 >= last - 1e-9); last = b.q50;
  }
  assert.ok(R.runout.p10 <= R.runout.p50 && R.runout.p50 <= R.runout.p90);
});

test('limit plan meets the risk target and never limits High-priority lines', () => {
  assert.ok(R.plan.before > 0.1);
  assert.ok(R.plan.after <= 0.1 + 1e-12, `after ${R.plan.after}`);
  for (const l of R.plan.limits) assert.notEqual(R.fleet.lines[l.i].priority, 'High');
});

test('planner returns no limits when the pool is already safe', () => {
  const fleet = generateFleet({});
  const m = fitModel(fleet.lines, fleet.endDay);
  const sim = simulateRemaining(fleet.lines, m, fleet.endDay, dayOf(2026, 11, 30), { sims: 300, seed: 2 });
  const used = usedThrough(fleet.lines, dayOf(2026, 11, 1), fleet.endDay);
  const p = planLimits(fleet.lines, sim, used, 1e9, 0.1);
  assert.equal(p.limits.length, 0);
});

test('headline: straight-line projection looks safe while the calibrated risk is material', () => {
  assert.ok(R.linear < R.allotment);
  assert.ok(R.pOver > 0.2 && R.pOver < 0.6, `pOver ${R.pOver}`);
});
