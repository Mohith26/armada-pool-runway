// Pool Runway: probabilistic forecast of a pooled Starlink data plan to the end
// of the billing cycle, calibrated on past cycles, plus a risk-constrained
// planner for per-service-line LIMIT settings.

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function normal(rng) {
  let u = 0, v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// ---- calendar ------------------------------------------------------------
export const EPOCH = Date.UTC(2026, 1, 1); // day 0 = Sun Feb 1, 2026
export function dayOf(y, m, d) { return Math.round((Date.UTC(y, m - 1, d) - EPOCH) / 864e5); }
export function dateOf(day) { return new Date(EPOCH + day * 864e5); }
export function dow(day) { return dateOf(day).getUTCDay(); } // 0 = Sun
export function cycles() {
  // monthly billing cycles May..Nov 2026
  const out = [];
  for (let m = 5; m <= 11; m++) {
    const start = dayOf(2026, m, 1);
    const end = dayOf(2026, m + 1, 1) - 1;
    out.push({ start, end, label: dateOf(start).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' }) });
  }
  return out;
}

// ---- synthetic fleet -----------------------------------------------------
const TYPES = {
  rig:     { n: 8, base: [16, 30], sigma: 0.22, dowW: [1, 1, 1, 1, 1, 1, 1], priority: 'High', plan: 'Global Priority' },
  scada:   { n: 7, base: [0.6, 2.2], sigma: 0.15, dowW: [1, 1, 1, 1, 1, 1, 1], priority: 'High', plan: 'Local Priority' },
  office:  { n: 6, base: [6, 13], sigma: 0.25, dowW: [0.35, 1.1, 1.15, 1.15, 1.1, 1.0, 0.4], priority: 'Medium', plan: 'Local Priority' },
  drone:   { n: 5, base: [3, 8], sigma: 0.35, dowW: [0.6, 1.1, 1.1, 1.1, 1.1, 1.0, 0.6], priority: 'Medium', plan: 'Local Priority', bursts: true },
  camp:    { n: 10, base: [14, 32], sigma: 0.28, dowW: [1.35, 0.9, 0.9, 0.9, 0.95, 1.1, 1.4], priority: 'Low', plan: 'Local Priority' }
};
const NAMES = {
  rig: ['Permian Rig 14', 'Permian Rig 22', 'Delaware Basin Rig 7', 'Midland Rig 31', 'Pecos Rig 9', 'Reeves County Rig 3', 'Loving County Rig 12', 'Ward County Rig 18'],
  scada: ['Wink Compressor Station', 'Kermit Pump Station', 'Mentone Meter Site', 'Orla Gas Plant', 'Pyote Tank Battery', 'Barstow Valve Site', 'Coyanosa Station'],
  office: ['Midland Field Office', 'Odessa Field Office', 'Pecos Yard Office', 'Monahans Ops Center', 'Carlsbad Field Office', 'Fort Stockton Office'],
  drone: ['Pipeline Drone Unit 1', 'Pipeline Drone Unit 2', 'Flare Inspection Drone', 'Survey Drone Team', 'Methane LiDAR Unit'],
  camp: ['Pecos Crew Camp A', 'Pecos Crew Camp B', 'Wink Crew Camp', 'Orla Man Camp', 'Mentone Crew Camp', 'Kermit Crew Camp', 'Toyah Crew Camp', 'Barstow Man Camp', 'Coyanosa Crew Camp', 'Jal Crew Camp']
};

export function generateFleet({ seed = 20261118, endDay = dayOf(2026, 11, 17) } = {}) {
  const rng = mulberry32(seed);
  const lines = [];
  for (const [type, cfg] of Object.entries(TYPES)) {
    for (let k = 0; k < cfg.n; k++) {
      const base = cfg.base[0] + (cfg.base[1] - cfg.base[0]) * rng();
      lines.push({
        id: `SL-${String(4100000 + Math.floor(rng() * 899999))}-${String(10000 + Math.floor(rng() * 89999))}`,
        name: NAMES[type][k], type, priority: cfg.priority, plan: cfg.plan,
        base, sigma: cfg.sigma, dowW: cfg.dowW, bursts: !!cfg.bursts,
        drift: 1 + (rng() - 0.5) * 0.3, // slow change over the year
        kit: `KIT${String(30000000 + Math.floor(rng() * 6e7))}`
      });
    }
  }
  const days = endDay + 1;
  // fleet-wide shocks (weather, software pushes) shared by every line
  const fleet = [];
  for (let d = 0; d < days; d++) {
    let f = Math.exp(0.1 * normal(rng));
    if (rng() < 0.03) f *= 1.5 + 0.4 * rng(); // fleet-wide software rollout
    fleet.push(f);
  }
  // November: a new crew rotation moves into the camps from Nov 7
  const crewStep = dayOf(2026, 11, 7);
  for (const L of lines) {
    const u = new Float64Array(days);
    let e = 0;
    for (let d = 0; d < days; d++) {
      e = 0.6 * e + Math.sqrt(1 - 0.36) * L.sigma * normal(rng);
      const trend = 1 + (L.drift - 1) * (d / days);
      let v = L.base * L.dowW[dow(d)] * trend * Math.exp(e) * fleet[d];
      if (L.type === 'camp' && d >= crewStep) v *= 1.3;
      if (L.bursts && rng() < 0.06) v += 25 + 70 * rng(); // survey upload day
      if (rng() < 0.01) v = 0;                            // terminal offline
      u[d] = Math.round(v * 100) / 100;
    }
    L.usage = u;
  }
  return { seed, endDay, lines };
}

// ---- forecasting ---------------------------------------------------------
const LEVEL_WIN = 14;
const RESID_WIN = 84;

function median(xs) {
  const a = [...xs].sort((x, y) => x - y);
  const n = a.length; if (!n) return 0;
  return n % 2 ? a[n >> 1] : (a[n / 2 - 1] + a[n / 2]) / 2;
}

// robust day-of-week factors: median per weekday over median overall
function dowFactors(u, t0, t1) {
  const by = Array.from({ length: 7 }, () => []);
  const all = [];
  for (let d = Math.max(0, t0); d <= t1; d++) { by[dow(d)].push(u[d]); all.push(u[d]); }
  const m = median(all) || 1e-3;
  return by.map(xs => Math.min(2, Math.max(0.3, (median(xs) || m) / m)));
}

// trailing deseasonalised level (median, so a burst or a dead day does not
// move it) using only days < t
function levelAt(u, f, t) {
  const xs = [];
  for (let d = Math.max(0, t - LEVEL_WIN); d < t; d++) xs.push(u[d] / f[dow(d)]);
  return median(xs);
}

// Fit per-line model with information up to day `asOf` (inclusive).
export function fitModel(lines, asOf) {
  return lines.map(L => {
    const f = dowFactors(L.usage, asOf - 55, asOf);
    const level = levelAt(L.usage, f, asOf + 1);
    // one-step-ahead log residuals vs the trailing level at the time; bursts,
    // outages and fleet-wide spikes all live here and get resampled
    const resid = new Map();
    for (let d = asOf - RESID_WIN + 1; d <= asOf; d++) {
      if (d < LEVEL_WIN) continue;
      const pred = levelAt(L.usage, f, d) * f[dow(d)];
      resid.set(d, Math.log((L.usage[d] + 0.05) / (pred + 0.05)));
    }
    return { f, level, resid };
  });
}

// Joint block bootstrap: each simulated day borrows one historical day's
// residuals for every line at once (keeps fleet-wide correlation), in
// blocks of 3 consecutive days (keeps persistence).
export function simulateRemaining(lines, model, asOf, endDay, { sims = 2000, seed = 7 } = {}) {
  const rng = mulberry32(seed);
  const days = [];
  for (let d = asOf + 1; d <= endDay; d++) days.push(d);
  const pool = [...model[0].resid.keys()].filter(d => d + 2 <= asOf);
  const nL = lines.length, nD = days.length;
  const perLine = Array.from({ length: nL }, () => new Float64Array(sims));
  const daily = Array.from({ length: nD }, () => new Float64Array(sims));
  for (let s = 0; s < sims; s++) {
    let j = 0, k = 3;
    for (let t = 0; t < nD; t++) {
      if (k >= 3) { j = pool[Math.floor(rng() * pool.length)]; k = 0; }
      const src = j + k; k++;
      let dayTot = 0;
      for (let i = 0; i < nL; i++) {
        const m = model[i];
        const r = m.resid.get(src) ?? 0;
        const mu = m.level * m.f[dow(days[t])];
        const v = Math.max(0, (mu + 0.05) * Math.exp(r) - 0.05);
        perLine[i][s] += v;
        dayTot += v;
      }
      daily[t][s] = dayTot;
    }
  }
  return { days, perLine, daily, sims };
}

// Conformal-style calibration: stretch each simulated path's remaining total
// around the median in log space by factor k (k is learned on past cycles).
export function stretch(sim, k) {
  if (k === 1) return sim;
  const S = sim.sims;
  const R = new Float64Array(S);
  for (const pl of sim.perLine) for (let s = 0; s < S; s++) R[s] += pl[s];
  const med = quantile(R, 0.5);
  const ratio = new Float64Array(S);
  for (let s = 0; s < S; s++) ratio[s] = R[s] > 0 ? (med * Math.pow(R[s] / med, k)) / R[s] : 1;
  return {
    ...sim,
    perLine: sim.perLine.map(pl => pl.map((v, s) => v * ratio[s])),
    daily: sim.daily.map(dl => dl.map((v, s) => v * ratio[s]))
  };
}

export function quantile(arr, q) {
  const a = Float64Array.from(arr).sort();
  const pos = (a.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
  return a[lo] + (a[hi] - a[lo]) * (pos - lo);
}

export function usedThrough(lines, start, asOf) {
  return lines.map(L => { let s = 0; for (let d = start; d <= asOf; d++) s += L.usage[d]; return s; });
}

// Totals per simulation (GB), including what was used so far.
export function totals(sim, used) {
  const U = used.reduce((a, b) => a + b, 0);
  const T = new Float64Array(sim.sims);
  for (let i = 0; i < sim.perLine.length; i++) for (let s = 0; s < sim.sims; s++) T[s] += sim.perLine[i][s];
  for (let s = 0; s < sim.sims; s++) T[s] += U;
  return T;
}

// ---- calibration on past cycles -----------------------------------------
// For each past cycle and checkpoint, forecast the remaining usage with only
// the data available then, record the actual, and learn the smallest log-space
// stretch k that makes the 80% band cover at least 80% of checkpoints.
export const STRETCH_GRID = [1, 1.25, 1.5, 1.75, 2, 2.5, 3, 3.5, 4];
export function backtest(fleet, { checkpoints = [5, 10, 15, 20, 25], sims = 400 } = {}) {
  const cyc = cycles().slice(0, -1); // May..Oct
  const rows = [];
  for (const c of cyc) for (const cp of checkpoints) {
    const asOf = c.start + cp - 1;
    const model = fitModel(fleet.lines, asOf);
    let actual = 0;
    for (const L of fleet.lines) for (let d = asOf + 1; d <= c.end; d++) actual += L.usage[d];
    const sim = simulateRemaining(fleet.lines, model, asOf, c.end, { sims, seed: 11 + asOf });
    const tot = totals(sim, fleet.lines.map(() => 0));
    rows.push({ cycle: c.label, day: cp + 1, asOf, actual, q10: quantile(tot, 0.1), q50: quantile(tot, 0.5), q90: quantile(tot, 0.9) });
  }
  const band = (r, k) => [r.q50 * Math.pow(r.q10 / r.q50, k), r.q50 * Math.pow(r.q90 / r.q50, k)];
  const coverage = k => rows.reduce((a, r) => { const [lo, hi] = band(r, k); return a + (r.actual >= lo && r.actual <= hi ? 1 : 0); }, 0);
  const need = Math.ceil(0.8 * rows.length);
  let chosen = STRETCH_GRID[STRETCH_GRID.length - 1];
  for (const k of STRETCH_GRID) if (coverage(k) >= need) { chosen = k; break; }
  const medErr = median(rows.map(r => Math.abs(r.actual / r.q50 - 1)));
  return { rows: rows.map(r => ({ ...r, lo: band(r, chosen)[0], hi: band(r, chosen)[1] })), coverageRaw: coverage(1), coverage: coverage(chosen), chosen, n: rows.length, medianAbsErr: medErr };
}

// ---- risk-constrained limit planner -------------------------------------
const WEIGHT = { Low: 1, Medium: 4, High: Infinity };

export function planLimits(lines, sim, used, allotment, alpha, { stepFrac = 0.05, maxIter = 4000 } = {}) {
  const nL = lines.length, S = sim.sims;
  const remainingCap = new Float64Array(nL).fill(Infinity); // GB still allowed this cycle
  const med = lines.map((_, i) => quantile(sim.perLine[i], 0.5));
  const T = totals(sim, used);
  const cur = Float64Array.from(T);
  const risk = () => cur.reduce((a, v) => a + (v > allotment ? 1 : 0), 0) / S;
  const excess = () => cur.reduce((a, v) => a + Math.max(0, v - allotment), 0) / S;
  const curtailment = new Float64Array(nL);
  const before = risk();
  let iter = 0;
  while (risk() > alpha && iter++ < maxIter) {
    let best = -1, bestScore = 0, bestNew = 0;
    const ex0 = excess();
    for (let i = 0; i < nL; i++) {
      const w = WEIGHT[lines[i].priority];
      if (!isFinite(w)) continue;
      const capNow = isFinite(remainingCap[i]) ? remainingCap[i] : quantile(sim.perLine[i], 0.99);
      const step = Math.max(1, stepFrac * (med[i] + used[i]));
      const newCap = Math.max(0, capNow - step);
      if (newCap === capNow) continue;
      // marginal effect on expected excess and on weighted curtailment
      let dEx = 0, dCut = 0;
      for (let s = 0; s < S; s++) {
        const r = sim.perLine[i][s];
        const a = Math.min(r, capNow), b = Math.min(r, newCap);
        const delta = a - b;
        if (delta <= 0) continue;
        dCut += delta;
        const t = cur[s];
        dEx += Math.max(0, t - allotment) - Math.max(0, t - delta - allotment);
      }
      if (dCut <= 0) continue;
      const score = (dEx / S) / (w * dCut / S);
      if (score > bestScore) { bestScore = score; best = i; bestNew = newCap; }
    }
    if (best < 0) break;
    const capNow = isFinite(remainingCap[best]) ? remainingCap[best] : quantile(sim.perLine[best], 0.99);
    for (let s = 0; s < S; s++) {
      const r = sim.perLine[best][s];
      cur[s] -= Math.min(r, capNow) - Math.min(r, bestNew);
    }
    remainingCap[best] = bestNew;
    void ex0;
  }
  const limits = [];
  for (let i = 0; i < nL; i++) {
    if (!isFinite(remainingCap[i])) continue;
    // LIMIT is set on the cycle total (MONTH period), rounded down to 10 GB
    const limitGB = Math.floor((used[i] + remainingCap[i]) / 10) * 10;
    const capRem = Math.max(0, limitGB - used[i]);
    let cut = 0;
    for (let s = 0; s < S; s++) cut += Math.max(0, sim.perLine[i][s] - capRem);
    curtailment[i] = cut / S;
    limits.push({ i, limitGB, expectedCurtailGB: cut / S });
  }
  // risk with a given set of rounded limits
  const riskWith = set => {
    const fin = Float64Array.from(T);
    for (const l of set) {
      const capRem = Math.max(0, l.limitGB - used[l.i]);
      for (let s = 0; s < S; s++) fin[s] -= Math.max(0, sim.perLine[l.i][s] - capRem);
    }
    return fin.reduce((a, v) => a + (v > allotment ? 1 : 0), 0) / S;
  };
  // drop limits that barely bind if the target still holds without them
  let kept = [...limits].sort((a, b) => a.expectedCurtailGB - b.expectedCurtailGB);
  for (const l of [...kept]) {
    const trial = kept.filter(x => x !== l);
    if (riskWith(trial) <= alpha) kept = trial;
  }
  limits.length = 0; limits.push(...kept.sort((a, b) => b.expectedCurtailGB - a.expectedCurtailGB));
  const after = riskWith(limits);
  return { before, after, limits, totalCurtailGB: limits.reduce((a, l) => a + l.expectedCurtailGB, 0) };
}

// ---- end to end ------------------------------------------------------------
export function runPool({ seed = 20261118, alpha = 0.1, sims = 2000 } = {}) {
  const fleet = generateFleet({ seed });
  const cyc = cycles();
  const cur = cyc[cyc.length - 1];
  const asOf = fleet.endDay;
  const past = cyc.slice(0, -1).map(c => {
    let t = 0; for (const L of fleet.lines) for (let d = c.start; d <= c.end; d++) t += L.usage[d];
    return { label: c.label, total: t };
  });
  // the customer's committed pool: sized off typical recent cycles, in TB
  const allotment = Math.round(past.slice(-3).reduce((a, p) => a + p.total, 0) / 3 * 1.06 / 1000) * 1000;
  const bt = backtest(fleet);
  const model = fitModel(fleet.lines, asOf);
  const sim = stretch(simulateRemaining(fleet.lines, model, asOf, cur.end, { sims, seed: 99 }), bt.chosen);
  const used = usedThrough(fleet.lines, cur.start, asOf);
  const T = totals(sim, used);
  const usedTotal = used.reduce((a, b) => a + b, 0);
  const pOver = T.reduce((a, v) => a + (v > allotment ? 1 : 0), 0) / T.length;
  // run-out day distribution
  const runout = new Int32Array(sim.sims).fill(-1);
  for (let s = 0; s < sim.sims; s++) {
    let c = usedTotal;
    for (let t = 0; t < sim.days.length; t++) { c += sim.daily[t][s]; if (c > allotment) { runout[s] = sim.days[t]; break; } }
  }
  const ro = Array.from(runout).filter(x => x >= 0).sort((a, b) => a - b);
  const cumBands = sim.days.map((d, t) => {
    const arr = new Float64Array(sim.sims);
    for (let s = 0; s < sim.sims; s++) { let c = usedTotal; for (let k = 0; k <= t; k++) c += sim.daily[k][s]; arr[s] = c; }
    return { day: d, q025: quantile(arr, 0.025), q10: quantile(arr, 0.1), q50: quantile(arr, 0.5), q90: quantile(arr, 0.9), q975: quantile(arr, 0.975) };
  });
  const plan = planLimits(fleet.lines, sim, used, allotment, alpha);
  const topUpGB = Math.max(0, quantile(T, 1 - alpha) - allotment);
  // what a straight-line projection of month-to-date usage would say
  const elapsed = asOf - cur.start + 1, cycleDays = cur.end - cur.start + 1;
  const linear = usedTotal / elapsed * cycleDays;
  return {
    fleet, cycle: cur, asOf, allotment, used, usedTotal, sim, totals: T, pOver,
    runout: ro.length ? { p10: ro[Math.floor(0.1 * (ro.length - 1))], p50: ro[Math.floor(0.5 * (ro.length - 1))], p90: ro[Math.floor(0.9 * (ro.length - 1))], n: ro.length } : null,
    cumBands, plan, topUpGB, backtest: bt, past, linear, alpha,
    q: { q10: quantile(T, 0.1), q50: quantile(T, 0.5), q90: quantile(T, 0.9) }
  };
}
