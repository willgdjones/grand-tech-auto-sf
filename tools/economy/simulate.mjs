#!/usr/bin/env node
// GTASF economy v3 calibrator (gtasf-economy-v3, pane 1 funding owner).
//
// Models an ACTIVE player driving between the real Tech Week events and SOLVES the base event payout and
// the five star thresholds so the time-to-star targets are hit:
//   ★1 Seed 30 min, ★2 Series A 2 h, ★3 Series B 5 h, ★4 Series C 10 h, ★5 Series D ("Decacorn") 20 h.
// Also prints the lazy continuous burn rates (idle loses exactly one round / 24 h) and the rescaled drop
// and angel values, and verifies an idle startup loses one round per 24 h.
//
// Run: node tools/economy/simulate.mjs   (reads worker/src/events/data/sf-tech-week.json)
//
// Method: the thresholds are, by construction, the active player's cumulative funding at each target time,
// so a player on this model hits each star exactly on target. We pick the base so Seed is a small,
// satisfying number (tens of $k, not millions), then read the later thresholds off the same curve. Burn is
// folded in with a short fixed-point iteration (thresholds -> burn rates -> net curve -> thresholds).

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const HOUR = 3600, DAY = 86_400;
const TARGETS = [ // [star, round id, label, seconds]
  [1, 'seed', 'Seed', 0.5 * HOUR],
  [2, 'series-a', 'Series A', 2 * HOUR],
  [3, 'series-b', 'Series B', 5 * HOUR],
  [4, 'series-c', 'Series C', 10 * HOUR],
  [5, 'series-d', 'Decacorn', 20 * HOUR],
];

// --- Active-player model parameters (documented; tune here) ---
const DRIVE_MPS = 9;          // effective speed between events incl. navigation/traffic overhead
const NN_CONST = 0.9;         // greedy nearest-neighbour tour-length constant (L ~ NN_CONST*sqrt(k*A))
const DWELL_S = 40;           // time spent at each event (approach, drive-through, next-target pick). With
                              // ~1596 events this is the dominant cost and keeps collection ~linear over the
                              // full 20 h so the ladder stays well spaced (events do not deplete at ~8 h).
const LIVE_SEEK = 0.35;       // effective live share for an ACTIVE player who prioritises live events (the
                              // ambient share is ~2%, but a player drives to what is live now for the premium)
const LIVE_NUM = 6, UPCOMING_NUM = 3, FOLLOWUP_NUM = 1, NUM_DENOM = 2; // timing multipliers /2 (as quoteFunding)
const AVG_CROWD = 1.15;       // modest crowd bonus on average (×1.0-×2.0 possible)
const AVG_STREAK = 1.4;       // modest streak bonus on average (×1.0-×2.0 possible)
const KIND_WEIGHTS = { community: 1, demo: 2.5, investor: 5 }; // base ratio preserved from v2 (200k:500k:1M)
const DROP_PERIOD_S = 12 * 60;// a VC drop reachable ~every 12 min for an active player
const DROP_FRACTION = 0.12;   // a drop is worth ~a few minutes of event earnings (12% of base event value)
const ANGEL_PERIOD_S = 2 * HOUR; // a hidden angel found ~every 2 h
const ANGEL_FRACTION = 1.7;   // founder 06:2x: a single angel must be ≤ ⅓ of Seed ($25k at Seed $75k). Modelled
                              // at ~1.7 event cheques (~$22k base, the founder's premise) with headroom under $25k,
                              // NOT scaled with the bigger event economy. Pane 2 owns the tiers (rarer pays more, max ≤ ⅓ Seed).
const SEED_TARGET_CENTS = 7_500_000n; // design anchor: Seed = $75k (founder 06:2x: a single ~$21.9k angel can't
                                      // reach Seed alone — largest base angel ≤ ⅓ Seed. Time targets unchanged;
                                      // base payouts + later thresholds re-solve proportionally around this.)

function loadEvents() {
  const raw = JSON.parse(readFileSync(join(ROOT, 'worker/src/events/data/sf-tech-week.json'), 'utf8'));
  const arr = Array.isArray(raw) ? raw : (raw.events ?? raw.items ?? Object.values(raw).find(Array.isArray));
  return arr;
}
function kindOf(e) {
  const t = `${e.host ?? ''} ${e.title ?? ''} ${(e.tags ?? []).join(' ')}`.toLowerCase();
  if (/\b(vc|vcs|venture|investors?|investing|investments?|fundraising|angel)\b/.test(t) || /\bcapital\b/.test((e.host ?? '').toLowerCase())) return 'investor';
  if (/\b(demo|pitch|showcase)\b/.test(t)) return 'demo';
  return 'community';
}
// Bounding-box area (m^2) of the events with coordinates, and the kind mix + a rough live share.
function densityModel(events) {
  const withXY = events.filter(e => Number.isFinite(e.lat) && Number.isFinite(e.lon));
  const lats = withXY.map(e => e.lat), lons = withXY.map(e => e.lon);
  const midLat = (Math.min(...lats) + Math.max(...lats)) / 2;
  const mPerDegLat = 111_320, mPerDegLon = 111_320 * Math.cos(midLat * Math.PI / 180);
  const h = (Math.max(...lats) - Math.min(...lats)) * mPerDegLat;
  const w = (Math.max(...lons) - Math.min(...lons)) * mPerDegLon;
  const area = w * h; // bbox m^2
  const mix = { community: 0, demo: 0, investor: 0 };
  for (const e of events) mix[kindOf(e)]++;
  const total = events.length;
  const avgKindWeight = (mix.community * KIND_WEIGHTS.community + mix.demo * KIND_WEIGHTS.demo + mix.investor * KIND_WEIGHTS.investor) / total;
  // Rough live share: across the week window, the fraction of events live at a random collection moment.
  const starts = events.map(e => Date.parse(e.start)).filter(Number.isFinite);
  const ends = events.map(e => (e.end ? Date.parse(e.end) : NaN));
  const t0 = Math.min(...starts), t1 = Math.max(...starts);
  let liveSum = 0, samples = 24;
  for (let i = 0; i < samples; i++) {
    const t = t0 + (t1 - t0) * (i + 0.5) / samples;
    let live = 0, soon = 0;
    for (let j = 0; j < events.length; j++) {
      const s = starts[j] ?? NaN, e = ends[j];
      if (Number.isFinite(s) && Number.isFinite(e) && e > s && t >= s && t < e) live++;
      else if (Number.isFinite(s) && t < s && s - t <= 2 * HOUR) soon++;
    }
    liveSum += (live + 0.5 * soon) / events.length; // soon counts partially (upcoming premium)
  }
  const liveShare = Math.min(0.6, liveSum / samples);
  return { total, area, avgKindWeight, liveShare };
}
// Cumulative events collected by time t. time(k) = drive(k) + k*DWELL, drive(k)=NN_CONST*sqrt(k*A)/V.
// Monotonic in k, so bisect for k(t). Capped at the finite pool.
function collected(t, total, area) {
  const timeFor = (k) => NN_CONST * Math.sqrt(k * area) / DRIVE_MPS + k * DWELL_S;
  let lo = 0, hi = total;
  for (let i = 0; i < 60; i++) { const k = (lo + hi) / 2; if (timeFor(k) < t) lo = k; else hi = k; }
  return lo;
}
function avgTimeMultiplier(liveShare) {
  // Weighted average of the timing multiplier the player actually gets (live premium + some upcoming).
  const live = liveShare, upcoming = Math.min(0.3, (1 - liveShare) * 0.4), followup = 1 - live - upcoming;
  return (live * LIVE_NUM + upcoming * UPCOMING_NUM + followup * FOLLOWUP_NUM) / NUM_DENOM;
}

function solve() {
  const events = loadEvents();
  const { total, area, avgKindWeight, liveShare } = densityModel(events);
  const timeMult = avgTimeMultiplier(LIVE_SEEK); // active player seeks live events; ambient liveShare reported for context
  const perEventMult = timeMult * AVG_CROWD * AVG_STREAK * avgKindWeight; // × base(community) = avg cheque

  // Gross funding (no burn) at time t, in "community-base" units (base=1): events + drops + angels.
  const grossUnits = (t) => {
    const ev = collected(t, total, area) * perEventMult;
    const drops = (t / DROP_PERIOD_S) * DROP_FRACTION * perEventMult;
    const angels = (t / ANGEL_PERIOD_S) * ANGEL_FRACTION * perEventMult;
    return ev + drops + angels;
  };

  // Flat per-stage burn (founder 06:3x): each star Seed..Decacorn has its own flat units/sec burn, ★0
  // (below Seed) has none. Calibrated to ~10% of that stage's gross earning rate, capped so an idle 24h
  // loses at most 25% of the stage's band (gentle: never a full round in a day; down rounds take several
  // idle days). Star s (1..5) spans time [T_{s-1}, T_s] and band [thr_{s-1}, thr_s). Returns b[1..5] units/sec.
  const burnRates = (thr) => {
    const b = {};
    for (let s = 1; s <= 5; s++) {
      const tStart = TARGETS[s - 1][3];                                              // time reaching star s
      const tEnd = s < 5 ? TARGETS[s][3] : TARGETS[4][3] + (TARGETS[4][3] - TARGETS[3][3]); // reaching s+1 (top extrapolated)
      const grossRate = (grossUnits(tEnd) - grossUnits(tStart)) / (tEnd - tStart);   // units/sec earned while at star s
      const band = s < 5 ? thr[s] - thr[s - 1] : thr[4] - thr[3];                    // star-s band width (reuse D−C for the top)
      b[s] = Math.min(0.10 * grossRate, 0.25 * band / DAY);                          // ~10% of earning, capped at 25% band / 24h
    }
    // Founder: burn RISES with stage. The top stage's gross rate plateaus (fewer fresh events past 20 h), so
    // its raw 10% can dip below the prior stage — clamp to non-decreasing (bands grow, so this stays ≤25%/24h).
    for (let s = 2; s <= 5; s++) b[s] = Math.max(b[s], b[s - 1]);
    return b;
  };
  // Net(t) = gross(t) − Σ_s b_s · (time spent at star s up to t). Star s occupies [T_{s-1}, T_s); ★0 (below
  // Seed, before T_0) never burns, so the climb to Seed is burn-free.
  const makeNet = (thr) => {
    const b = burnRates(thr);
    return (t) => {
      let burned = 0;
      for (let s = 1; s <= 5; s++) {
        const tStart = TARGETS[s - 1][3], tEnd = s < 5 ? TARGETS[s][3] : Infinity;
        burned += b[s] * Math.max(0, Math.min(t, tEnd) - tStart);
      }
      return Math.max(0, grossUnits(t) - burned);
    };
  };
  // Fixed-point: thresholds (=net funding at target times) -> burn rates -> net curve -> thresholds.
  let thresholds = TARGETS.map(([, , , s]) => grossUnits(s)); // start: ignore burn
  for (let iter = 0; iter < 40; iter++) {
    const net = makeNet(thresholds);
    const next = TARGETS.map(([, , , s]) => net(s));
    if (next.every((v, i) => Math.abs(v - thresholds[i]) / (thresholds[i] || 1) < 1e-4)) { thresholds = next; break; }
    thresholds = next;
  }
  // Scale so Seed threshold == SEED_TARGET_CENTS; base(community) cents = scale.
  const base = Number(SEED_TARGET_CENTS) / thresholds[0];
  const cents = (units) => BigInt(Math.round(units * base));
  const netUnits = makeNet(thresholds);
  return { total, area, liveShare, timeMult, perEventMult, base, thresholds, cents, grossUnits, netUnits, burnUnits: burnRates(thresholds) };
}

function fmt(c) { const d = Number(c) / 100; return d >= 1e6 ? `$${(d / 1e6).toFixed(2)}M` : d >= 1e3 ? `$${(d / 1e3).toFixed(1)}k` : `$${d.toFixed(0)}`; }

const r = solve();
console.log(`\n=== GTASF economy v3 — solved against ${r.total} real events (${(r.area / 1e6).toFixed(1)} km² bbox, live share ${(r.liveShare * 100).toFixed(0)}%) ===`);
console.log(`avg per-event multiplier (time×crowd×streak×kind): ${r.perEventMult.toFixed(2)}×  |  community base = ${fmt(r.cents(1))}`);
console.log(`\nBASE EVENT PAYOUTS (cents):`);
for (const [k, w] of Object.entries(KIND_WEIGHTS)) console.log(`  ${k.padEnd(10)} ${String(r.cents(w)).padStart(10)}  (${fmt(r.cents(w))})`);
console.log(`\nSTAR THRESHOLDS (cents):`);
TARGETS.forEach(([star, id, label, s], i) => {
  console.log(`  ★${star} ${label.padEnd(10)} ${String(r.cents(r.thresholds[i])).padStart(12)}  (${fmt(r.cents(r.thresholds[i]))})  @ ${(s / HOUR).toFixed(1)}h`);
});
console.log(`\nVC DROP: ${fmt(r.cents(DROP_FRACTION * r.perEventMult))}   ANGEL (base, ×harder-find for rarer): ${fmt(r.cents(ANGEL_FRACTION * r.perEventMult))}`);
console.log(`\nBURN (flat per-stage, ★0 Bootstrapping none; idle 24h loses ≤25% of band — several idle days to drop a round):`);
TARGETS.forEach(([star, , label]) => {
  const b = r.burnUnits[star];                                                   // units/sec at this star
  const perMin = r.cents(b * 60), idle24h = r.cents(b * DAY);                     // cents/min and cents lost over 24h idle
  const band = r.cents(star < 5 ? r.thresholds[star] - r.thresholds[star - 1] : r.thresholds[4] - r.thresholds[3]);
  const pct = Number(idle24h) / Number(band) * 100;
  console.log(`  ★${star} ${label.padEnd(10)} −${fmt(perMin)}/min   idle 24h −${fmt(idle24h)} = ${pct.toFixed(0)}% of band`);
});
// --- Self-check (non-zero exit on failure, so pane 6 can run this as an economy gate) ---
const fails = [];
// 1. Ladder strictly increasing.
for (let i = 1; i < r.thresholds.length; i++) if (!(r.thresholds[i] > r.thresholds[i - 1] * 1.3)) fails.push(`ladder: ★${i + 1} not >1.3× ★${i}`);
// 2. Active player hits each star within tolerance (invert the net curve; ±5min for Seed, ±10% elsewhere).
const crossTime = (units) => { let lo = 0, hi = 30 * HOUR; for (let i = 0; i < 60; i++) { const t = (lo + hi) / 2; if (r.netUnits(t) < units) lo = t; else hi = t; } return lo; };
TARGETS.forEach(([star, , label, target], i) => {
  const t = crossTime(r.thresholds[i]);
  const tol = i === 0 ? 5 * 60 : target * 0.1;
  const ok = Math.abs(t - target) <= tol;
  console.log(`  hit ★${star} ${label.padEnd(10)} at ${(t / HOUR).toFixed(2)}h (target ${(target / HOUR).toFixed(2)}h) ${ok ? '✓' : '✗'}`);
  if (!ok) fails.push(`timing: ★${star} at ${(t / HOUR).toFixed(2)}h, want ${(target / HOUR).toFixed(2)}h`);
});
// 3. Flat per-stage burn: every star 1..5 burns >0, and idle 24h loses at most ~25% of its band (gentle —
//    never a full round in a day; ★0 Bootstrapping, below Seed, never burns).
TARGETS.forEach(([star, , label]) => {
  const b = r.burnUnits[star];
  const band = star < 5 ? r.thresholds[star] - r.thresholds[star - 1] : r.thresholds[4] - r.thresholds[3];
  const pct = (b * DAY) / band;
  if (!(b > 0)) fails.push(`burn: ★${star} ${label} has no burn (only ★0 should)`);
  if (pct > 0.2501) fails.push(`burn: ★${star} ${label} idle 24h = ${(pct * 100).toFixed(0)}% of band (> 25%, too onerous)`);
});
console.log(`\nVERIFY idle 24h ≤ 25% of band at every star — flat per-stage burn, several idle days to drop a round.`);
if (fails.length) { console.error(`\nECONOMY SIM FAILED:\n  ${fails.join('\n  ')}`); process.exit(1); }
console.log(`\nECONOMY SIM OK — all star timings and burn within tolerance.`);

// Machine-readable calibration dump (SIM_JSON=1) — the exact integers to port into shared/funding.ts and
// to assert in the econ-v3 tests / founder smoke, so code and simulator can never silently drift.
if (process.env.SIM_JSON) console.log('\nSIM_JSON ' + JSON.stringify({
  seedTargetCents: Number(SEED_TARGET_CENTS),
  base: { community: Number(r.cents(KIND_WEIGHTS.community)), demo: Number(r.cents(KIND_WEIGHTS.demo)), investor: Number(r.cents(KIND_WEIGHTS.investor)) },
  thresholds: Object.fromEntries(TARGETS.map(([, id], i) => [id, Number(r.cents(r.thresholds[i]))])),
  burnPerMinCents: Object.fromEntries(TARGETS.map(([star, id]) => [id, Number(r.cents(r.burnUnits[star] * 60))])),
  angelBaseCents: Number(r.cents(ANGEL_FRACTION * r.perEventMult)),
}));
