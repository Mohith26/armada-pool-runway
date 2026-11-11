import { runPool, planLimits, quantile, dateOf } from './core/pool.js';

const $ = id => document.getElementById(id);
const R = runPool({ alpha: 0.1 });
const plans = { 0.1: R.plan };
let alpha = 0.1;

const md = d => dateOf(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const tb = gb => `${(gb / 1000).toFixed(gb >= 10000 ? 2 : 1)} TB`;
const tb1 = gb => `${(gb / 1000).toFixed(1)} TB`;
const gbf = gb => gb >= 1000 ? tb1(gb) : `${Math.round(gb)} GB`;
const pct = x => `${Math.round(x * 100)}%`;
const pct1 = x => `${(x * 100).toFixed(x < 0.1 ? 1 : 0)}%`;
const ICON = { rig: 'ti-building-factory', scada: 'ti-gauge', office: 'ti-building', drone: 'ti-drone', camp: 'ti-tent' };
const TYPE = { rig: 'Drilling rig', scada: 'SCADA site', office: 'Field office', drone: 'Drone unit', camp: 'Crew camp' };

function kpis() {
  const c = R.cycle, left = c.end - R.asOf;
  $('kUsed').textContent = tb(R.usedTotal);
  $('kUsedBar').style.width = `${Math.min(100, (R.usedTotal / R.allotment) * 100)}%`;
  $('kUsedSub').textContent = `of ${tb1(R.allotment)} pool · ${pct(R.usedTotal / R.allotment)} used`;
  $('kAlert').textContent = R.usedTotal / R.allotment >= 0.8 ? '80% usage alert fired' : '80% usage alert not triggered yet';
  $('kRisk').textContent = pct(R.pOver);
  $('kRiskL').textContent = `Chance of running out by ${md(c.end)}`;
  $('kMed').textContent = `${tb1(R.q.q50)} expected cycle total`;
  $('kRange').textContent = `${tb1(R.q.q10)} to ${tb1(R.q.q90)} (80% range)`;
  $('kLinear').textContent = `${tb1(R.linear)} straight-line projection`;
  if (R.runout) {
    $('kRunout').textContent = md(R.runout.p50);
    $('kRunRange').textContent = `${md(R.runout.p10)} to ${md(R.runout.p90)} in 80% of run-outs`;
  } else { $('kRunout').textContent = 'None'; $('kRunRange').textContent = 'Pool lasts the cycle'; }
  $('kLeft').textContent = `${left} days left in the cycle`;
  $('kLines').textContent = `${R.fleet.lines.length} service lines share the pool`;
  const b = R.backtest;
  $('kCal').textContent = `${b.coverage} of ${b.n}`;
  $('kCalSub').textContent = `Calibrated on May to Oct 2026`;
  $('kRaw').textContent = `Uncalibrated model: ${b.coverageRaw} of ${b.n}`;
  $('kErr').textContent = `Median error of the forecast: ${(b.medianAbsErr * 100).toFixed(1)}%`;
  $('chartSub').textContent = `Cumulative pool usage, ${md(c.start)} to ${md(c.end)} 2026 · as of ${md(R.asOf)}`;
}

function svgEl(w, h, inner) { return `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" preserveAspectRatio="none">${inner}</svg>`; }

function cycleChart() {
  const host = $('chart');
  const W = host.clientWidth - 20 || 760, H = 268, L = 46, Rt = 16, T = 14, B = 26;
  const c = R.cycle;
  const days = []; for (let d = c.start; d <= c.end; d++) days.push(d);
  const actual = []; let cum = 0;
  for (let d = c.start; d <= R.asOf; d++) { for (const ln of R.fleet.lines) cum += ln.usage[d]; actual.push([d, cum]); }
  const ymax = Math.ceil(Math.max(R.allotment, R.cumBands.at(-1).q975) / 2000) * 2000 + 1000;
  const x = d => L + (d - c.start) / (c.end - c.start) * (W - L - Rt);
  const y = v => T + (1 - v / ymax) * (H - T - B);
  let g = '';
  for (let v = 0; v <= ymax; v += 4000) g += `<line x1="${L}" x2="${W - Rt}" y1="${y(v)}" y2="${y(v)}" stroke="#20333a"/><text class="tick" x="${L - 8}" y="${y(v) + 4}" text-anchor="end">${v / 1000} TB</text>`;
  for (const d of days) if ((d - c.start) % 5 === 0 || d === c.end) g += `<text class="tick" x="${x(d)}" y="${H - 6}" text-anchor="middle">${md(d)}</text>`;
  const bands = [[R.asOf, R.usedTotal, R.usedTotal, R.usedTotal, R.usedTotal, R.usedTotal], ...R.cumBands.map(b => [b.day, b.q025, b.q10, b.q50, b.q90, b.q975])];
  const area = (lo, hi) => `M${bands.map(b => `${x(b[0])},${y(b[hi])}`).join('L')}L${[...bands].reverse().map(b => `${x(b[0])},${y(b[lo])}`).join('L')}Z`;
  g += `<path d="${area(1, 5)}" fill="rgba(0,216,205,.13)"/><path d="${area(2, 4)}" fill="rgba(0,216,205,.30)"/>`;
  g += `<path d="M${bands.map(b => `${x(b[0])},${y(b[3])}`).join('L')}" fill="none" stroke="#e8ecec" stroke-width="1.6" stroke-dasharray="5 4"/>`;
  g += `<path d="M${actual.map(([d, v]) => `${x(d)},${y(v)}`).join('L')}" fill="none" stroke="#00d8cd" stroke-width="2.4"/>`;
  g += `<line x1="${L}" x2="${W - Rt}" y1="${y(R.allotment)}" y2="${y(R.allotment)}" stroke="#feb902" stroke-width="1.5" stroke-dasharray="7 5"/>`;
  g += `<text class="tick" x="${L + 6}" y="${y(R.allotment) - 6}" style="fill:#feb902">${tb1(R.allotment)} pool</text>`;
  g += `<line x1="${x(R.asOf)}" x2="${x(R.asOf)}" y1="${T}" y2="${H - B}" stroke="#4f5b5e" stroke-dasharray="2 3"/><text class="tick" x="${x(R.asOf) + 5}" y="${T + 10}">Today</text>`;
  if (R.runout) g += `<circle cx="${x(R.runout.p50)}" cy="${y(R.allotment)}" r="4.5" fill="#d90d0c" stroke="#01141a" stroke-width="2"/>`;
  g += `<rect id="hover" x="${L}" y="${T}" width="${W - L - Rt}" height="${H - T - B}" fill="transparent"/><line id="hl" y1="${T}" y2="${H - B}" stroke="#8c9192" stroke-width="1" opacity="0"/>`;
  host.innerHTML = svgEl(W, H, g) + '<div class="tip" id="tip" hidden></div>';
  const svg = host.querySelector('svg');
  svg.addEventListener('mousemove', ev => {
    const r = svg.getBoundingClientRect();
    const px = (ev.clientX - r.left) * (W / r.width);
    const d = Math.round(c.start + (px - L) / (W - L - Rt) * (c.end - c.start));
    if (d < c.start || d > c.end) return;
    const tip = $('tip'), hl = svg.querySelector('#hl');
    hl.setAttribute('x1', x(d)); hl.setAttribute('x2', x(d)); hl.setAttribute('opacity', 1);
    let html;
    if (d <= R.asOf) html = `<b>${md(d)}</b><br>Used so far: ${tb(actual[d - c.start][1])}`;
    else { const b = R.cumBands.find(z => z.day === d); html = `<b>${md(d)} (forecast)</b><br>Median: ${tb(b.q50)}<br>80% range: ${tb1(b.q10)} to ${tb1(b.q90)}`; }
    tip.innerHTML = html; tip.hidden = false;
    tip.style.left = `${Math.min(x(d) * r.width / W + 24, r.width - 170)}px`; tip.style.top = '30px';
  });
  svg.addEventListener('mouseleave', () => { $('tip').hidden = true; svg.querySelector('#hl').setAttribute('opacity', 0); });
}

function calChart() {
  const host = $('calChart');
  const W = host.clientWidth - 20 || 380, H = 196, L = 40, Rt = 8, T = 12, B = 30;
  const rows = R.backtest.rows;
  const err = v => v * 100;
  const lim = 40;
  const x = i => L + (i + 0.5) / rows.length * (W - L - Rt);
  const y = v => T + (1 - (Math.max(-lim, Math.min(lim, v)) + lim) / (2 * lim)) * (H - T - B);
  let g = '';
  for (const v of [-40, -20, 0, 20, 40]) g += `<line x1="${L}" x2="${W - Rt}" y1="${y(v)}" y2="${y(v)}" stroke="${v === 0 ? '#4f5b5e' : '#20333a'}"/><text class="tick" x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${v > 0 ? '+' : ''}${v}%</text>`;
  rows.forEach((r, i) => {
    const lo = err(r.lo / r.actual - 1), hi = err(r.hi / r.actual - 1), mid = err(r.q50 / r.actual - 1);
    const ok = r.actual >= r.lo && r.actual <= r.hi;
    const col = ok ? '#308d57' : '#d90d0c';
    g += `<line x1="${x(i)}" x2="${x(i)}" y1="${y(lo)}" y2="${y(hi)}" stroke="${col}" stroke-width="5" stroke-linecap="round" opacity=".55"><title>${r.cycle}, day ${r.day}: band ${tb1(r.lo)} to ${tb1(r.hi)}, actual ${tb1(r.actual)}</title></line>`;
    g += `<circle cx="${x(i)}" cy="${y(mid)}" r="2.6" fill="#e8ecec"/>`;
  });
  const cyc = [...new Set(rows.map(r => r.cycle))];
  cyc.forEach((cname, k) => {
    const idx = rows.findIndex(r => r.cycle === cname);
    if (k) g += `<line x1="${(x(idx) + x(idx - 1)) / 2}" x2="${(x(idx) + x(idx - 1)) / 2}" y1="${T}" y2="${H - B}" stroke="#20333a"/>`;
    g += `<text class="tick" x="${x(idx + 2)}" y="${H - 10}" text-anchor="middle">${cname.split(' ')[0]}</text>`;
  });
  host.innerHTML = svgEl(W, H, g);
  const b = R.backtest;
  $('calNote').innerHTML = `Each bar is the 80% band at day 6, 11, 16, 21 and 26 of a past cycle, shown as error against what actually happened; dots are the median. <b>${b.coverage} of ${b.n}</b> bands held after widening by the learned factor ${b.chosen}x (the raw simulation held ${b.coverageRaw}).`;
}

function planner() {
  if (!plans[alpha]) plans[alpha] = planLimits(R.fleet.lines, R.sim, R.used, R.allotment, alpha);
  const p = plans[alpha];
  document.querySelectorAll('#alphaSeg span').forEach(s => s.classList.toggle('on', +s.dataset.a === alpha));
  const camps = p.limits.filter(l => R.fleet.lines[l.i].type === 'camp').length;
  const others = p.limits.length - camps;
  const who = camps && !others ? `${camps} crew camps` : `${p.limits.length} service lines`;
  $('planSub').innerHTML = p.limits.length
    ? `Monthly limits on ${who} bring the chance of running out from <b>${pct(p.before)}</b> to <b>${pct1(p.after)}</b>, curtailing an expected ${gbf(p.totalCurtailGB)}. Rigs and SCADA sites are never limited.`
    : `The chance of running out is already under ${pct(alpha)}. No limits needed.`;
  const topUp = Math.max(0, quantile(R.totals, 1 - alpha) - R.allotment);
  $('topupBtn').textContent = topUp > 0 ? `Or add a ${tb1(topUp)} top-up` : 'No top-up needed';
  $('applyBtn').textContent = p.limits.length ? `Apply ${p.limits.length} limits` : 'Nothing to apply';
  const rows = [];
  const show = [...p.limits.map(l => l.i)];
  const high = R.fleet.lines.map((L, i) => i).filter(i => R.fleet.lines[i].priority === 'High').sort((a, b) => quantile(R.sim.perLine[b], 0.5) - quantile(R.sim.perLine[a], 0.5)).slice(0, 2);
  for (const i of [...show, ...high]) {
    const L = R.fleet.lines[i];
    const lim = p.limits.find(l => l.i === i);
    const p50 = R.used[i] + quantile(R.sim.perLine[i], 0.5), p90 = R.used[i] + quantile(R.sim.perLine[i], 0.9);
    rows.push(`<tr><td><div class="sl"><span class="ic"><i class="ti ${ICON[L.type]}"></i></span><div><div class="nm">${L.name}</div><div class="pl">${TYPE[L.type]} · ${L.plan} · Starlink</div></div></div></td>
      <td><span class="pri ${L.priority}">${L.priority}</span></td>
      <td class="r">${gbf(R.used[i])}</td>
      <td class="r">${gbf(p50)} <span class="small">· p90 ${gbf(p90)}</span></td>
      <td class="r">${lim ? `<span class="lim">${lim.limitGB.toLocaleString()} GB / month</span>` : '<span class="muted">Never limited</span>'}</td>
      <td class="r">${lim ? gbf(lim.expectedCurtailGB) : '<span class="muted">-</span>'}</td></tr>`);
  }
  $('planBody').innerHTML = rows.join('');
}

function boot() {
  kpis(); cycleChart(); calChart(); planner();
  document.querySelectorAll('#alphaSeg span').forEach(s => s.addEventListener('click', () => { alpha = +s.dataset.a; planner(); }));
  $('applyBtn').addEventListener('click', () => {
    const p = plans[alpha]; if (!p.limits.length) return;
    const t = $('toast'); t.textContent = `Saved ${p.limits.length} LIMIT settings (period: MONTH) on Gulf & Permian Pool. Concept demo: nothing was sent.`; t.hidden = false;
    setTimeout(() => { t.hidden = true; }, 3500);
  });
  window.addEventListener('resize', () => { cycleChart(); calChart(); });
  const q = new URLSearchParams(location.search);
  if (q.get('risk')) { alpha = +q.get('risk'); planner(); }
}
boot();
