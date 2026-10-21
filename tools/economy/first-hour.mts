// Economy v3 first-hour / offline-cost simulator (gtasf-econv3 review, docs/economy/v3-review.md).
// Unlike simulate.mjs (an averaged calibration model), this drives a concrete player through the REAL
// event venues from the Ferry Building spawn, pays each pass with the real quote formula at the real
// clock (live / upcoming / follow-up / preview lull), the real streak rule and the real v3 burn.
// Run: npx tsx tools/economy/first-hour.mts [ISO start time ...]
import { readFileSync } from 'node:fs';
import { ECON_V3_ROUNDS, FUNDING_BASE_CENTS_V3, ECON_V3_BURN_PER_MIN_CENTS, applyEconomyV3Burn, fundingKind,
  fundingTiming, isPreviewLull, nextFundingStreak, DRIVE_THROUGH_RADIUS_M, formatFunding } from '../../shared/funding';

type Ev = { id: string; title: string; host?: string | null; tags?: string[]; start: string; end?: string | null; lat: number | null; lon: number | null };
const raw = JSON.parse(readFileSync(new URL('../../worker/src/events/data/sf-tech-week.json', import.meta.url), 'utf8'));
const events: Ev[] = Array.isArray(raw) ? raw : raw.events;
const M_LAT = 111_320, M_LON = 111_320 * Math.cos(37.79 * Math.PI / 180);
const xy = (lat: number, lon: number) => ({ x: (lon + 122.3937) * M_LON, z: -(lat - 37.7955) * M_LAT }); // Ferry = origin
const placed = events.filter(e => Number.isFinite(e.lat) && Number.isFinite(e.lon)).map(e => ({ e, ...xy(e.lat!, e.lon!) }));

/** BASE_PCT=50 previews a halved event base without editing shared/funding.ts. */
const BASE_PCT = BigInt(process.env.BASE_PCT ?? '100');
// Same pay formula as quoteFunding (crowd 0 = a lone player), with the v3 base.
function quote(e: Ev, now: number, streak: number, preview: boolean): bigint {
  const raw = fundingTiming(e, now);
  const early = preview && raw === 'follow-up' && Date.parse(e.start) > now;
  const timing = early ? 'upcoming' : raw, num = timing === 'live' ? 6n : timing === 'upcoming' ? 3n : 1n;
  return FUNDING_BASE_CENTS_V3[fundingKind(e)] * BASE_PCT / 100n * num * 10n * BigInt(3 + Math.min(5, streak)) / 80n;
}
const roundOf = (c: bigint) => [...ECON_V3_ROUNDS].reverse().find(r => c >= BigInt(r.thresholdCents))!;

interface Opts { label: string; speed: number; roadFactor: number; stopS: number; greedy: boolean; setupS: number }
function play(startIso: string, o: Opts, minutes = Number(process.env.MINUTES ?? 60)) {
  const t0 = Date.parse(startIso), preview = isPreviewLull(events, t0);
  let x = 0, z = 0, t = 0, cur = 0n, life = 0n, prev: { eventId: string; at: number; count: number } | null = null;
  const paid = new Set<string>(), log: string[] = [], marks: Record<string, number> = {};
  let nextLog = 0, cheques = 0, biggest = 0n;
  const burnTo = (target: number) => { // burn runs continuously in real time between events
    if (target > t) { cur = applyEconomyV3Burn(cur, target - t).currentCents; t = target; }
  };
  t = o.setupS; // onboarding / naming / finding a car
  while (t < minutes * 60) {
    const now = t0 + t * 1000;
    // candidate venues: unpaid events with coords
    let best: { score: number; d: number; group: typeof placed } | null = null;
    const cands = placed.filter(p => !paid.has(p.e.id)).map(p => ({ p, d: Math.hypot(p.x - x, p.z - z) }))
      .sort((a, b) => a.d - b.d).slice(0, o.greedy ? 60 : 1);
    for (const { p, d } of cands) {
      const group = placed.filter(q => !paid.has(q.e.id) && Math.hypot(q.x - p.x, q.z - p.z) <= DRIVE_THROUGH_RADIUS_M);
      const secs = d * o.roadFactor / o.speed + o.stopS;
      const val = group.reduce((s, q) => s + Number(quote(q.e, now + secs * 1000, 3, preview)), 0);
      const score = o.greedy ? val / secs : -d;
      if (!best || score > best.score) best = { score, d, group };
    }
    if (!best) break;
    const arrive = t + best.d * o.roadFactor / o.speed + o.stopS;
    if (arrive > minutes * 60) { burnTo(minutes * 60); break; }
    burnTo(arrive);
    const at = t0 + arrive * 1000, streak = nextFundingStreak(prev, best.group[0]!.e.id, at);
    let got = 0n;
    for (const q of best.group) { got += quote(q.e, at, streak, preview); paid.add(q.e.id); }
    prev = { eventId: best.group[0]!.e.id, at, count: streak };
    const before = roundOf(cur); cur += got; life += got; cheques++; if (got > biggest) biggest = got;
    const after = roundOf(cur); if (after.id !== before.id && !(after.id in marks)) marks[after.id] = arrive / 60;
    x = best.group[0]!.x; z = best.group[0]!.z;
    while (nextLog <= arrive / 60) { log.push(`  ${String(nextLog).padStart(2)}m  ${formatFunding(cur.toString()).padStart(8)}  ${roundOf(cur).label}`); nextLog += 5; }
  }
  while (nextLog <= minutes) { log.push(`  ${String(nextLog).padStart(2)}m  ${formatFunding(cur.toString()).padStart(8)}  ${roundOf(cur).label}`); nextLog += 5; }
  console.log(`\n## ${o.label} — start ${startIso} (preview lull: ${preview})`);
  console.log(`  cheques ${cheques}, avg ${formatFunding((life / BigInt(Math.max(1, cheques))).toString())}, biggest ${formatFunding(biggest.toString())}, lifetime ${formatFunding(life.toString())}, current ${formatFunding(cur.toString())}`);
  console.log(`  round reached at: ${Object.entries(marks).map(([k, v]) => `${k} ${v.toFixed(1)}m`).join(', ') || 'none'}`);
  console.log(log.join('\n'));
  return { cur, life };
}
const starts = process.argv.slice(2).length ? process.argv.slice(2)
  : ['2026-10-05T03:00:00Z' /* playtest Oct 4 20:00 PT */, '2026-10-05T15:00:00Z' /* launch Oct 5 08:00 PT */, '2026-10-08T01:00:00Z' /* Oct 7 18:00 PT peak */];
const casual: Opts = { label: 'Casual (nearest event next, 9 m/s, 40 s/stop — simulate.mjs model)', speed: 9, roadFactor: 1, stopS: 40, greedy: false, setupS: 180 };
const keen: Opts = { label: 'Keen (best $/s within reach, 12 m/s, road ×1.3, 15 s/stop)', speed: 12, roadFactor: 1.3, stopS: 15, greedy: true, setupS: 120 };
for (const s of starts) { play(s, casual); play(s, keen); }

// Cost of a day offline at each stage: a player parked mid-band, and on the band floor.
console.log('\n## Cost of 24 h offline (v3 flat burn)');
for (let i = 1; i < ECON_V3_ROUNDS.length; i++) {
  const r = ECON_V3_ROUNDS[i]!, lo = BigInt(r.thresholdCents), hi = i + 1 < ECON_V3_ROUNDS.length ? BigInt(ECON_V3_ROUNDS[i + 1]!.thresholdCents) : lo * 2n;
  for (const [where, c] of [['floor+1%', lo + (hi - lo) / 100n], ['mid-band', (lo + hi) / 2n]] as const) {
    const out = applyEconomyV3Burn(c, 86_400), out3 = applyEconomyV3Burn(c, 3 * 86_400);
    console.log(`  ${r.label.padEnd(9)} ${where.padEnd(8)} ${formatFunding(c.toString()).padStart(7)} → 1 day ${formatFunding(out.currentCents.toString()).padStart(7)} (${roundOf(out.currentCents).label}) · 3 days ${formatFunding(out3.currentCents.toString()).padStart(7)} (${roundOf(out3.currentCents).label})  burn −${formatFunding((ECON_V3_BURN_PER_MIN_CENTS[r.id]!).toString())}/min`);
  }
}
