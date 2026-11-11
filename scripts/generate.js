// Writes data/summary.json from the seeded fleet (same code the page runs).
import { runPool, planLimits, quantile, dateOf } from '../core/pool.js';
import { writeFileSync } from 'node:fs';
const r = runPool({ alpha: 0.1 });
const d = x => dateOf(x).toISOString().slice(0, 10);
const plan = a => { const p = a === 0.1 ? r.plan : planLimits(r.fleet.lines, r.sim, r.used, r.allotment, a); return { target: a, before: +p.before.toFixed(4), after: +p.after.toFixed(4), limits: p.limits.length, curtailGB: +p.totalCurtailGB.toFixed(1), topUpGB: +Math.max(0, quantile(r.totals, 1 - a) - r.allotment).toFixed(0) }; };
const out = {
  seed: r.fleet.seed, asOf: d(r.asOf), allotmentGB: r.allotment, usedGB: +r.usedTotal.toFixed(1), linearGB: +r.linear.toFixed(0),
  forecastGB: { q10: +r.q.q10.toFixed(0), q50: +r.q.q50.toFixed(0), q90: +r.q.q90.toFixed(0) }, pOverrun: r.pOver,
  runout: r.runout && { p10: d(r.runout.p10), p50: d(r.runout.p50), p90: d(r.runout.p90) },
  backtest: { checkpoints: r.backtest.n, coveredCalibrated: r.backtest.coverage, coveredRaw: r.backtest.coverageRaw, stretch: r.backtest.chosen, medianAbsErr: +r.backtest.medianAbsErr.toFixed(4) },
  plans: [0.05, 0.1, 0.2].map(plan), pastCycles: r.past.map(p => ({ cycle: p.label, totalGB: +p.total.toFixed(0) }))
};
writeFileSync(new URL('../data/summary.json', import.meta.url), JSON.stringify(out, null, 2) + '\n');
console.log(JSON.stringify(out));
