# Pool Runway for Armada Atlas Data Pools (concept)

**Live demo:** https://mohith26.github.io/armada-pool-runway/

Unofficial concept demo by Mohith Gajjela. Not affiliated with Armada. Synthetic data.

## What it is

A **Pool forecast** tab for Atlas → Data Pools. For a pooled Starlink plan it answers three questions mid-cycle:

1. **Will the pool run out before the cycle ends, and when?** A probability, a run-out date range, and a forecast band for cumulative usage.
2. **Can I trust that number?** Every pool's forecast is backtested on its own past cycles, and the band is widened until it would have held at least 80% of the time.
3. **What should I do about it?** The cheapest set of monthly LIMIT settings (Atlas's existing `LIMIT` / `MONTH` setting type) that brings the chance of running out under a chosen target, never touching high-priority lines; or the top-up size that would do the same.

## Why

Atlas pools data across terminals and shows usage, static ALERT/LIMIT thresholds and a per-line daily anomaly baseline. Those tell you what already happened. Mid-cycle, an operator really wants to know whether today's pace plus normal noise ends above the pool, and which knobs to turn. Straight-line projection misses weekly patterns, survey upload bursts, fleet-wide spikes (software pushes) and step changes like a new crew rotation. In the demo the straight-line projection says 17.7 TB, safely under the 19 TB pool, while the calibrated forecast gives a 32% chance of running out, most likely on Nov 29.

## How it works

`core/pool.js`:

- **Synthetic fleet** (seeded): 36 service lines on one pool for a fictional Permian Basin operator: drilling rigs and SCADA sites (High priority), field offices and drone units with survey-upload bursts (Medium), crew camps with weekend peaks (Low). AR(1) noise per line, shared fleet-wide shocks, occasional software-push days, dead days, and a crew rotation that lifts camp usage 30% from Nov 7. Daily usage Feb 1 to Nov 17, 2026, the same shape as the Atlas API's `DailyUsageDto`.
- **Per-line model**: robust day-of-week factors (weekday median over overall median) and a trailing 14-day median level, so one burst or dead day does not move it. One-step-ahead log residuals against that level over the last 84 days carry everything else (bursts, outages, spikes).
- **Joint block bootstrap**: each simulated future day borrows one historical day's residuals *for every line at once*, in 3-day blocks. That keeps fleet-wide correlation (a software push hits every terminal the same day) and short-term persistence. 2,000 paths to the end of the cycle.
- **Calibration**: at days 6, 11, 16, 21 and 26 of each past cycle (May to Oct, 30 checkpoints) the same model forecasts the rest of the cycle using only data available then. The raw 80% band held 14 of 30 times. A single log-space stretch around the median, chosen as the smallest factor that makes the band hold at least 80% of the time (here 2.5x, holding 25 of 30), is applied to today's simulation.
- **Limit planner**: a greedy, marginal-cost descent over the simulated paths. Each step lowers one eligible line's cap by 5% of its expected cycle total, picking the line with the largest reduction in expected overrun per weighted GB curtailed (Low weight 1, Medium 4, High never). It stops when P(overrun) is under the target, rounds limits down to 10 GB, recomputes the risk, and drops limits that barely bind.

## Results (seed 20261118, as of Nov 17, 2026)

| | Value |
|---|---|
| Pool / used so far | 19.0 TB / 10.03 TB (53%, the 80% alert has not fired) |
| Straight-line projection | 17.7 TB |
| Calibrated forecast (median, 80% range) | 18.3 TB, 17.0 to 20.2 TB |
| Chance of running out by Nov 30 | 32% (most likely Nov 29; Nov 28 to Nov 30 in 80% of run-outs) |
| Backtest, 80% band held | 25 of 30 calibrated (14 of 30 raw); median error 5.3% |
| Limit plan at 10% target | 9 crew-camp limits, risk 32% → 9.8%, expected 468 GB curtailed |
| Alternatives | 5% target: 10 limits, 4.2%, 611 GB; 20%: 9 limits, 19.8%, 317 GB; or a 1.2 TB top-up |

Every number on the page is computed in the browser from the seeded data.

## Tests

```
node --test
```

Determinism and non-negativity of the fleet; robustness of the level to a burst; the stretch keeps the median and widens the band; backtest coverage is monotone in the stretch and the calibrated band holds at least 24 of 30; forecast bands are ordered and cumulative; the plan meets the risk target and never limits High lines; no limits when the pool is safe; and the headline (straight line under the pool while the risk is between 20% and 60%).

## Honest limitations

- Synthetic fleet; real pools will have different burst and outage patterns. The method only needs the daily per-line usage Atlas already stores.
- 30 checkpoints is a small calibration set; coverage of 25/30 has wide uncertainty. One global stretch factor is crude; per-pool or per-horizon factors would be better with more history.
- Limits are applied as end-of-cycle caps on remaining usage; real Starlink limits throttle rather than cut, so curtailed GB overstates the impact on users.
- The planner is greedy, not a proven optimum, and assumes lines behave the same with and without a limit.
- UI uses Helvetica Neue for Atlas's Helvetica Now Display and Tabler icons as a close match for Atlas's line icons.

## Novelty note

Checked armada.ai Atlas product page (pooled plans, real-time monitoring, "intelligent prediction and alerting" for maintenance), the Atlas alert screenshot ("Data usage anomaly detected" with a dynamic daily baseline and expected usage range), the public `armadasystems/armada-api-client` (data pool settings are static ALERT/LIMIT thresholds by DAY/WEEK/MONTH/ALL), Armada press releases from 2025 to 2026, and Space Capital's Atlas write-up. None forecast pool exhaustion with a calibrated probability or recommend limits against a risk target. A competitor, Starfleet Hub, shows a cycle forecast and auto-throttles at plan limits; Kognitive notifies at thresholds. The calibrated risk plus risk-constrained limit planning is the new part.
