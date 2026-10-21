import { DatabaseSync } from 'node:sqlite';
import { recordFundingCredit, creditedRefs } from '../funding/credits';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  pitchTargetNear, pitchSpotsAt, founderPlazaSpot, founderPitchTarget, founderMemePitchTarget, founderSeriesATarget, founderSeedFloor, founderSeriesAFloor, clampPitchFloor, judgeMessages, PITCH_ANGEL_RADIUS_M, PITCH_VC_RADIUS_M,
  fallbackScore, parseJudge, pitchBaseCents, pitchCredit, pitchPayoutCents, PITCH_JUDGE_DAILY_MICRO_USD, PITCH_JUDGE_RESERVE_MICRO_USD,
  reconcileJudgeSpend, reserveJudgeSpend, runPitch, type PitchDeps, type PitchTarget,
  devicePitchedBefore, founderFirstPitchMin, FIRST_PITCH_MIN_CENTS,
} from './pitch';
import { FOUNDER_PLAZA_VC_ID, FOUNDER_PLAZA_VC_NAME, FOUNDER_SEED_VC_ID, FOUNDER_SEED_VC_NAME, FOUNDER_SERIES_A_ID, FOUNDER_SERIES_A_NAME, FOUNDER_SERIES_A_PERSONA } from '@gtasf/shared/founder/pitch';
import { CELEB_NPCS } from '@gtasf/shared/content/celebs';
import { PITCH_VCS } from '@gtasf/shared/content/pitchVcs';
import { MEME_NPCS } from '@gtasf/shared/founder/memeQuests';
import { project } from '../funding/anchors';

function freshDb() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../../migrations/0040_pitch_judge_spend.sql', import.meta.url), 'utf8'));
  const prepare = (sql: string) => {
    const statement = sqlite.prepare(sql); let bindings: (string | number | null)[] = [];
    const wrapper = { bind(...values: (string | number | null)[]) { bindings = values; return wrapper; },
      async first() { return statement.get(...bindings) ?? null; },
      async run() { return { meta: statement.run(...bindings), success: true }; } };
    return wrapper;
  };
  return { sqlite, db: { prepare } as unknown as D1Database };
}
const NOON_PT = Date.parse('2026-10-08T19:00:00Z');
const angel: PitchTarget = { kind: 'angel', id: 'ada-angel', name: 'Ada the Angel' };
const vc: PitchTarget = { kind: 'vc', id: 'founders-fund', name: 'Founders Fund' };
const judgeReply = (text: string, usage = { prompt_tokens: 500, completion_tokens: 40, total_tokens: 540 }) => ({ text, finishReason: 'stop', usage });
function deps(over: Partial<PitchDeps> = {}) {
  const award = vi.fn<PitchDeps['award']>(async () => ({ credited: true }));
  const judge = vi.fn<PitchDeps['judge']>(async () => judgeReply('{"score": 8, "verdict": "Bold. Wrong, but bold."}'));
  const reconcile = vi.fn<PitchDeps['reconcile']>(async () => {});
  const reserve = vi.fn<PitchDeps['reserve']>(async () => true);
  const credited = vi.fn<PitchDeps['credited']>(async () => false);
  return { award, judge, reconcile, reserve, credited, ...over };
}

describe('pitch payout', () => {
  it('is 0.5x..1.5x a live demo-event cheque, integer cents, clamped', () => {
    const base = pitchBaseCents();
    expect(pitchPayoutCents(0)).toBe(base * 5n / 10n);
    expect(pitchPayoutCents(10)).toBe(base * 15n / 10n);
    expect(pitchPayoutCents(5)).toBe(base);
    expect(pitchPayoutCents(42)).toBe(pitchPayoutCents(10));
    expect(pitchPayoutCents(-3)).toBe(pitchPayoutCents(0));
    expect(pitchPayoutCents(Number.NaN)).toBe(pitchPayoutCents(0));
    expect(pitchPayoutCents(6.6)).toBe(pitchPayoutCents(7));
    for (let s = 0; s < 10; s++) expect(pitchPayoutCents(s + 1) > pitchPayoutCents(s)).toBe(true);
  });
});

describe('pitch cooldown keys (funding_credits UNIQUE)', () => {
  it('angel: once ever; VC: once per SF day', () => {
    expect(pitchCredit(angel, NOON_PT)).toEqual({ source: 'celebrity', sourceRef: 'ada-angel' });
    expect(pitchCredit(angel, NOON_PT + 3 * 86_400_000)).toEqual(pitchCredit(angel, NOON_PT));
    expect(pitchCredit(vc, NOON_PT)).toEqual({ source: 'celebrity', sourceRef: 'pitch:vc:founders-fund:2026-10-08' });
    expect(pitchCredit(vc, NOON_PT + 3_600_000).sourceRef).toBe(pitchCredit(vc, NOON_PT).sourceRef);
    expect(pitchCredit(vc, NOON_PT + 86_400_000).sourceRef).toBe('pitch:vc:founders-fund:2026-10-09');
  });
  it('rejects ids that could collide with other refs', () => {
    expect(() => pitchCredit({ ...vc, id: 'a:b' }, NOON_PT)).toThrow(RangeError);
    expect(() => pitchCredit({ ...angel, id: '' }, NOON_PT)).toThrow(RangeError);
  });
});

describe('judge reply parsing', () => {
  it('accepts JSON with prose/fences, clamps and trims', () => {
    expect(parseJudge('```json\n{"score": 7, "verdict": "  Ship it.  "}\n```')).toEqual({ score: 7, verdict: 'Ship it.' });
    expect(parseJudge('{"score":"4","verdict":"Fine."}')).toEqual({ score: 4, verdict: 'Fine.' });
    expect(parseJudge('{"score": 6.6, "verdict": "x"}')?.score).toBe(7);
    expect(parseJudge(`{"score": 5, "verdict": "${'a'.repeat(300)}"}`)?.verdict.length).toBe(120);
  });
  it('rejects malformed or out-of-range replies (-> fallback)', () => {
    for (const bad of ['no json', '{"score": 11, "verdict": "x"}', '{"score": -1, "verdict": "x"}', '{"score": 5}', '{"verdict": "x"}', '{"score": 5, "verdict": "   "}', '{bad json}'])
      expect(parseJudge(bad)).toBeNull();
  });
});

describe('fallback score', () => {
  it('is 1..7 and rewards length + substance, never a top score', () => {
    expect(fallbackScore('')).toBe(1);
    expect(fallbackScore('hi')).toBe(1);
    const strong = 'We solve a real problem for customers: 400 paying users, revenue growing 20% a month, retention is great, the team launched a pilot and the market is huge. '.repeat(3);
    expect(fallbackScore(strong)).toBe(7);
    // Repeating a buzzword counts once: 4 words, 1 distinct substance word.
    expect(fallbackScore('market market market market')).toBe(1);
  });
});

describe('judge spend meter ($10/day)', () => {
  it('reserves per call up to the cap, then refuses and counts', async () => {
    const { db, sqlite } = freshDb();
    const cap = PITCH_JUDGE_RESERVE_MICRO_USD * 3;
    expect(await reserveJudgeSpend(db, NOON_PT, cap)).toBe(true);
    expect(await reserveJudgeSpend(db, NOON_PT, cap)).toBe(true);
    expect(await reserveJudgeSpend(db, NOON_PT, cap)).toBe(true);
    expect(await reserveJudgeSpend(db, NOON_PT, cap)).toBe(false);
    const row = sqlite.prepare('SELECT micro_usd, calls, refused FROM pitch_judge_spend').get() as { micro_usd: number; calls: number; refused: number };
    expect(row).toEqual({ micro_usd: cap, calls: 3, refused: 1 });
    // A new SF day starts fresh.
    expect(await reserveJudgeSpend(db, NOON_PT + 86_400_000, cap)).toBe(true);
  });
  it('reconciles the reservation to measured cost, never below zero', async () => {
    const { db, sqlite } = freshDb();
    await reserveJudgeSpend(db, NOON_PT); await reconcileJudgeSpend(db, NOON_PT, 700);
    expect((sqlite.prepare('SELECT micro_usd FROM pitch_judge_spend').get() as { micro_usd: number }).micro_usd).toBe(700);
    await reconcileJudgeSpend(db, NOON_PT, 0); await reconcileJudgeSpend(db, NOON_PT, 0);
    expect((sqlite.prepare('SELECT micro_usd FROM pitch_judge_spend').get() as { micro_usd: number }).micro_usd).toBe(0);
    expect(PITCH_JUDGE_DAILY_MICRO_USD).toBe(10_000_000);
  });
});

describe('runPitch', () => {
  it('moderation rejection pays nothing and never calls the judge', async () => {
    for (const moderation of ['rejected', 'dropped', 'unavailable', 'gone'] as const) {
      const d = deps();
      expect(await runPitch(vc, 'pitch', moderation, NOON_PT, d)).toEqual({ status: 'blocked', reason: 'moderation' });
      expect(d.judge).not.toHaveBeenCalled(); expect(d.award).not.toHaveBeenCalled(); expect(d.reserve).not.toHaveBeenCalled();
    }
  });
  it('AI judge: pays score-scaled cheque on the cooldown key, reconciles measured cost', async () => {
    const d = deps();
    const out = await runPitch(vc, 'We sell shovels to AI miners.', 'sent', NOON_PT, d);
    expect(out).toEqual({ status: 'judged', credited: true, score: 8, verdict: 'Bold. Wrong, but bold.', amountCents: pitchPayoutCents(8).toString(), judge: 'ai' });
    expect(d.award).toHaveBeenCalledWith(expect.objectContaining({ source: 'celebrity', sourceRef: 'pitch:vc:founders-fund:2026-10-08', amountCents: pitchPayoutCents(8).toString(), label: 'Pitch to Founders Fund' }));
    expect(d.reconcile).toHaveBeenCalledWith(500 * 1 + 40 * 5);
  });
  it('over the daily cap: fallback score, judge not called', async () => {
    const d = deps({ reserve: vi.fn(async () => false) });
    const out = await runPitch(angel, 'Uber for dogs. We have users and revenue.', 'sent', NOON_PT, d);
    expect(d.judge).not.toHaveBeenCalled(); expect(d.reconcile).not.toHaveBeenCalled();
    expect(out).toMatchObject({ status: 'judged', judge: 'fallback', score: fallbackScore('Uber for dogs. We have users and revenue.') });
    expect(d.award).toHaveBeenCalledWith(expect.objectContaining({ source: 'celebrity', sourceRef: 'ada-angel' }));
  });
  it('judge failure or junk reply: fallback, failed call bills 0', async () => {
    const thrown = deps({ judge: vi.fn(async () => { throw new Error('timeout'); }) });
    expect(await runPitch(vc, 'x', 'sent', NOON_PT, thrown)).toMatchObject({ judge: 'fallback' });
    expect(thrown.reconcile).toHaveBeenCalledWith(0);
    const junk = deps({ judge: vi.fn(async () => judgeReply('I refuse to score this.')) });
    expect(await runPitch(vc, 'x', 'sent', NOON_PT, junk)).toMatchObject({ judge: 'fallback' });
  });
  it('cooldown pre-check: an already-paid target skips the judge and pays nothing', async () => {
    const d = deps({ credited: vi.fn(async (source, ref) => source === 'celebrity' && ref === 'ada-angel') });
    expect(await runPitch(angel, 'again', 'sent', NOON_PT, d)).toEqual({ status: 'blocked', reason: 'cooldown' });
    expect(d.reserve).not.toHaveBeenCalled(); expect(d.judge).not.toHaveBeenCalled(); expect(d.award).not.toHaveBeenCalled();
    // Same VC, next SF day: a new key, so the pitch is judged again.
    const v = deps({ credited: vi.fn(async (_s, ref) => ref === 'pitch:vc:founders-fund:2026-10-08') });
    expect(await runPitch(vc, 'x', 'sent', NOON_PT, v)).toEqual({ status: 'blocked', reason: 'cooldown' });
    expect(await runPitch(vc, 'x', 'sent', NOON_PT + 86_400_000, v)).toMatchObject({ status: 'judged' });
  });
  it('a race past the pre-check (ledger says already credited) reports credited:false', async () => {
    const d = deps({ award: vi.fn(async () => ({ credited: false })) });
    expect(await runPitch(angel, 'again', 'sent', NOON_PT, d)).toMatchObject({ status: 'judged', credited: false });
  });
});

describe('runPitch scripted-round floor (close the Seed round)', () => {
  const SEED = 300_000_000n; // the active economy's 'seed' threshold ($3M) — what handlePitchTap passes for the Seed pitch
  it('tops the cheque up so the resulting total reaches the threshold', async () => {
    // currentTotal $1M, floor $3M -> need $2M, which exceeds the largest possible score-sized cheque, so it floors.
    const d = deps();
    const out = await runPitch(vc, 'x', 'sent', NOON_PT, d, { minResultCents: SEED, currentTotalCents: 100_000_000n });
    expect(out).toMatchObject({ status: 'judged', credited: true, amountCents: '200000000' });
    expect(200_000_000n).toBeGreaterThan(pitchPayoutCents(8)); // the floor, not the score-8 judge, set the amount
    expect(d.award).toHaveBeenCalledWith(expect.objectContaining({ amountCents: '200000000' }));
  });
  it('never reduces a larger judged cheque', async () => {
    // currentTotal $2.9M, floor $3M -> need only $0.1M, below the score-8 cheque, so the judged amount stands.
    const d = deps();
    const out = await runPitch(vc, 'x', 'sent', NOON_PT, d, { minResultCents: SEED, currentTotalCents: 290_000_000n });
    expect(out).toMatchObject({ amountCents: pitchPayoutCents(8).toString() });
    expect(pitchPayoutCents(8)).toBeGreaterThan(10_000_000n);
  });
  it('is a no-op once the player is already at/over the threshold', async () => {
    const d = deps();
    const out = await runPitch(vc, 'x', 'sent', NOON_PT, d, { minResultCents: SEED, currentTotalCents: 300_000_000n });
    expect(out).toMatchObject({ amountCents: pitchPayoutCents(8).toString() });
  });
  it('a scripted round never pairs its cheque with a canned REJECTION line when the AI judge is down', async () => {
    const down = deps({ reserve: vi.fn(async () => false) }); // judge unavailable -> fallback scoring
    const floored = await runPitch(vc, 'x', 'sent', NOON_PT, down, { minResultCents: SEED, currentTotalCents: 0n });
    expect(floored).toMatchObject({ judge: 'fallback', credited: true });
    expect(['Not a fit for this fund, but keep in touch.', 'Come back when you have traction.']).not.toContain((floored as { verdict: string }).verdict);
    const plain = await runPitch(vc, 'x', 'sent', NOON_PT, deps({ reserve: vi.fn(async () => false) })); // no floor (Pre-seed), still paid
    expect(plain).toMatchObject({ judge: 'fallback' });
    expect(['Not a fit for this fund, but keep in touch.', 'Come back when you have traction.']).not.toContain((plain as { verdict: string }).verdict);
  });
  it('no floor (the Pre-seed plaza pitch): a plain score-sized cheque', async () => {
    const d = deps();
    const out = await runPitch(vc, 'x', 'sent', NOON_PT, d);
    expect(out).toMatchObject({ amountCents: pitchPayoutCents(8).toString() });
  });
});

describe('pitch targets', () => {
  const spots = [{ kind: 'angel' as const, id: 'a', name: 'A', x: 0, z: 0 }, { kind: 'vc' as const, id: 'v', name: 'V', x: 100, z: 0 }];
  it('angel within 8 m, VC within 15 m, nearest wins, nothing out of reach', () => {
    expect(pitchTargetNear(PITCH_ANGEL_RADIUS_M - .1, 0, spots)?.id).toBe('a');
    expect(pitchTargetNear(PITCH_ANGEL_RADIUS_M + .1, 0, spots)).toBeUndefined();
    expect(pitchTargetNear(100 - PITCH_VC_RADIUS_M + .1, 0, spots)?.id).toBe('v');
    expect(pitchTargetNear(50, 0, spots)).toBeUndefined();
  });
  it('the real roster: VC ids are valid ledger refs, and nobody is reachable far away', () => {
    for (const v of PITCH_VCS) expect(() => pitchCredit({ kind: 'vc', id: v.id, name: v.name }, NOON_PT)).not.toThrow();
    expect(pitchTargetNear(1e6, 1e6)).toBeUndefined();
  });
  // gtasf-y5vc: the AI judge must never write a verdict in a named real person's voice. Real-person
  // celebrity NPCs are excluded from the voice-pitch target set; standing on one resolves to no target.
  it('excludes real-person celebrities from the voice-pitch targets', () => {
    const all = pitchSpotsAt(NOON_PT);
    const targetIds = new Set(all.map(s => s.id));
    for (const n of CELEB_NPCS) {
      expect(targetIds.has(n.id)).toBe(false);
      const { x, z } = project(n.spot[0], n.spot[1]);
      expect(pitchTargetNear(x, z, all)?.id).not.toBe(n.id);
    }
    // VC offices remain pitchable.
    expect(all.some(s => s.kind === 'vc')).toBe(true);
  });
});

describe('founder meme pitch targets (phase 5, flags.memeQuests)', () => {
  it('resolves a pitch-kind meme NPC to a fictional-persona VC target; unknown ids are undefined', () => {
    const t = founderMemePitchTarget('patagonia-vest-vc')!;
    expect(t.kind).toBe('vc');
    expect(t.id).toBe('patagonia-vest-vc');
    expect(t.name).toBe('A Patagonia-vest VC');
    expect(t.persona).toBe('a Patagonia-vest VC, a San Francisco investor');
    expect(Number.isFinite(t.x) && Number.isFinite(t.z)).toBe(true);
    expect(founderMemePitchTarget('no-such-npc')).toBeUndefined();
  });
  it('the judge speaks as the fictional persona, never "a partner at <firm>"', () => {
    const system = judgeMessages(founderMemePitchTarget('patagonia-vest-vc')!, 'we are building the thing')[0]!.content;
    expect(system).toContain('a Patagonia-vest VC, a San Francisco investor');
    expect(system).not.toContain('a partner at');
  });
  it('meme pitches use the per-SF-day VC cooldown, and no meme id collides with a real firm id', () => {
    const t = founderMemePitchTarget('patagonia-vest-vc')!;
    expect(pitchCredit(t, NOON_PT)).toEqual({ source: 'celebrity', sourceRef: 'pitch:vc:patagonia-vest-vc:2026-10-08' });
    expect(pitchCredit(t, NOON_PT + 86_400_000).sourceRef).toBe('pitch:vc:patagonia-vest-vc:2026-10-09');
    const firmIds = new Set(PITCH_VCS.map(v => v.id));
    for (const npc of MEME_NPCS) expect(firmIds.has(npc.id)).toBe(false);
  });
});

describe('founder Series A Demo Day target (phase 6, flags.seriesAQuest)', () => {
  it('resolves the fictional Demo Day house VC target with its MC persona', () => {
    const t = founderSeriesATarget();
    expect(t.kind).toBe('vc');
    expect(t.id).toBe(FOUNDER_SERIES_A_ID);
    expect(t.name).toBe(FOUNDER_SERIES_A_NAME);
    expect(t.persona).toBe(FOUNDER_SERIES_A_PERSONA);
    expect(Number.isFinite(t.x) && Number.isFinite(t.z)).toBe(true);
  });
  it('the judge speaks as the fictional MC, never "a partner at <firm>", and the id never collides with a real firm', () => {
    const system = judgeMessages(founderSeriesATarget(), 'we are building the thing')[0]!.content;
    expect(system).toContain(FOUNDER_SERIES_A_PERSONA);
    expect(system).not.toContain('a partner at');
    const firmIds = new Set(PITCH_VCS.map(v => v.id));
    expect(firmIds.has(FOUNDER_SERIES_A_ID)).toBe(false);
  });
  it('uses the per-SF-day VC cooldown ref', () => {
    expect(pitchCredit(founderSeriesATarget(), NOON_PT).sourceRef).toBe(`pitch:vc:${FOUNDER_SERIES_A_ID}:2026-10-08`);
  });
});

describe('founder Seed floor (ladder Seed pitch only, never a meme pitch)', () => {
  const seed = '3000000', preSeed = '500000'; // the Seed threshold + the prior (Pre-seed) threshold the player must have reached
  it('tops up the Seed firm pitch to the Seed threshold once the player has reached Pre-seed', () => {
    expect(founderSeedFloor(FOUNDER_SEED_VC_ID, undefined, seed, '1000000', preSeed)).toEqual({ minResultCents: 3000000n, currentTotalCents: 1000000n });
  });
  it('does not apply to the Pre-seed plaza pitch, nor when there is no Seed round', () => {
    expect(founderSeedFloor(FOUNDER_PLAZA_VC_ID, undefined, seed, '1000000', preSeed)).toBeUndefined();
    expect(founderSeedFloor(FOUNDER_SEED_VC_ID, undefined, undefined, '1000000', preSeed)).toBeUndefined();
  });
  it('STAGE GATE: a player who has not reached Pre-seed is NOT floored to Seed (no rung skip)', () => {
    // $1k total, Pre-seed needs $5k -> no floor (an out-of-order Seed pitch can't skip the Pre-seed rung).
    expect(founderSeedFloor(FOUNDER_SEED_VC_ID, undefined, seed, '100000', preSeed)).toBeUndefined();
    // Exactly at the prior threshold -> the floor applies (boundary inclusive).
    expect(founderSeedFloor(FOUNDER_SEED_VC_ID, undefined, seed, preSeed, preSeed)).toEqual({ minResultCents: 3000000n, currentTotalCents: 500000n });
  });
  it('never applies to a meme pitch, even one that spoofs vcId:first-round (gate on resolved target + memeNpcId)', () => {
    // A meme pitch resolves target.id = the meme id (not the Seed firm) and carries memeNpcId; either excludes it.
    expect(founderSeedFloor('patagonia-vest-vc', 'patagonia-vest-vc', seed, '1000000', preSeed)).toBeUndefined();
    // Belt-and-braces: memeNpcId set excludes the floor even if a target somehow carried the Seed firm id.
    expect(founderSeedFloor(FOUNDER_SEED_VC_ID, 'patagonia-vest-vc', seed, '1000000', preSeed)).toBeUndefined();
  });
});

describe('founder Series A floor (phase 6 Demo Day pitch only, never a meme pitch)', () => {
  const seriesA = '2500000000', seedThreshold = '7500000'; // the Series A threshold ($25M) + the prior (Seed) threshold required
  it('tops up the Demo Day house pitch to the Series A threshold once the player has reached Seed', () => {
    expect(founderSeriesAFloor(FOUNDER_SERIES_A_ID, undefined, seriesA, '1000000000', seedThreshold)).toEqual({ minResultCents: 2500000000n, currentTotalCents: 1000000000n });
  });
  it('does not apply to the Seed firm, nor when there is no Series A round', () => {
    expect(founderSeriesAFloor(FOUNDER_SEED_VC_ID, undefined, seriesA, '1000000000', seedThreshold)).toBeUndefined();
    expect(founderSeriesAFloor(FOUNDER_SERIES_A_ID, undefined, undefined, '1000000000', seedThreshold)).toBeUndefined();
  });
  it('STAGE GATE: an early founder who has not reached Seed is NOT floored to Series A (no rung skip)', () => {
    // $50k total, Seed needs $75k -> no floor; an Idea/Pre-seed founder pitching the Demo Day house can't skip to Series A.
    expect(founderSeriesAFloor(FOUNDER_SERIES_A_ID, undefined, seriesA, '5000000', seedThreshold)).toBeUndefined();
    // Exactly at the Seed threshold -> the floor applies (boundary inclusive).
    expect(founderSeriesAFloor(FOUNDER_SERIES_A_ID, undefined, seriesA, seedThreshold, seedThreshold)).toEqual({ minResultCents: 2500000000n, currentTotalCents: 7500000n });
  });
  it('never applies to a meme pitch (gate on resolved target + memeNpcId)', () => {
    expect(founderSeriesAFloor('patagonia-vest-vc', 'patagonia-vest-vc', seriesA, '1000000000', seedThreshold)).toBeUndefined();
    expect(founderSeriesAFloor(FOUNDER_SERIES_A_ID, 'patagonia-vest-vc', seriesA, '1000000000', seedThreshold)).toBeUndefined();
  });
});

describe('clampPitchFloor (single-credit cap, economy-v3 Series A vs MAX_CREDIT_CENTS)', () => {
  const cap = 20_000_000n; // MAX_CREDIT_CENTS in economy-v3 ($200k)
  it('clamps a floor whose top-up would exceed the cap (Series A $698k from a low Seed total)', () => {
    // A Seed player at $75k, Series A floor to $698k → top-up $623k > $200k cap → would throw at the award (503).
    const clamped = clampPitchFloor({ minResultCents: 69_841_638n, currentTotalCents: 7_500_000n }, cap);
    expect(clamped).toEqual({ minResultCents: 27_500_000n, currentTotalCents: 7_500_000n }); // 7.5M + 20M cap
    expect(clamped!.minResultCents - clamped!.currentTotalCents).toBe(cap); // top-up exactly the cap
  });
  it('passes a floor through unchanged when its top-up already fits the cap (e.g. the Seed floor)', () => {
    const floor = { minResultCents: 3_000_000n, currentTotalCents: 1_000_000n }; // top-up $20k < cap
    expect(clampPitchFloor(floor, cap)).toBe(floor);
  });
  it('never raises the floor, and passes undefined through', () => {
    expect(clampPitchFloor(undefined, cap)).toBeUndefined();
    // Already at/over the target → top-up ≤ 0, well under the cap → unchanged.
    const atTarget = { minResultCents: 5_000_000n, currentTotalCents: 9_000_000n };
    expect(clampPitchFloor(atTarget, cap)).toBe(atTarget);
  });
});

describe('runPitch against the real funding ledger (gtasf-paiz)', () => {
  function ledger() {
    const sqlite = new DatabaseSync(':memory:');
    for (const m of ['0010_funding.sql', '0014_funding_bonus.sql', '0018_fund_drops.sql', '0020_funding_credits.sql'])
      sqlite.exec(readFileSync(new URL(`../../migrations/${m}`, import.meta.url), 'utf8'));
    const db = { prepare(sql: string) {
      const statement = sqlite.prepare(sql); let bindings: (string | number | null)[] = [];
      const wrapper = { bind(...values: (string | number | null)[]) { bindings = values; return wrapper; },
        async first() { return statement.get(...bindings) ?? null; }, async all() { return { results: statement.all(...bindings), success: true }; },
        async run() { return { meta: statement.run(...bindings), success: true }; } };
      return wrapper;
    } } as unknown as D1Database;
    sqlite.prepare('INSERT INTO funding_profiles(device_id,token_hash,startup_name,nickname,created_at,updated_at) VALUES(?,?,?,?,?,?)').run('dev-1', 'h', 'Fogware', 'Foggy', NOON_PT, NOON_PT);
    return { sqlite, db };
  }
  const realDeps = (db: D1Database, judge = vi.fn<PitchDeps['judge']>(async () => judgeReply('{"score": 6, "verdict": "Fine."}'))) => ({ judge,
    credited: async (source: Parameters<PitchDeps['credited']>[0], ref: string) => (await creditedRefs(db, 'dev-1', source)).has(ref),
    reserve: async () => true, reconcile: async () => {},
    award: (input: Parameters<PitchDeps['award']>[0]) => recordFundingCredit(db, { deviceId: 'dev-1', now: NOON_PT, ...input }) });
  it('a VC pitch pays once per SF day and the repeat skips the judge', async () => {
    const { db, sqlite } = ledger(), d = realDeps(db);
    expect(await runPitch(vc, 'We have paying users.', 'sent', NOON_PT, d)).toMatchObject({ status: 'judged', credited: true, amountCents: pitchPayoutCents(6).toString() });
    expect(await runPitch(vc, 'Again!', 'sent', NOON_PT + 60_000, d)).toEqual({ status: 'blocked', reason: 'cooldown' });
    expect(d.judge).toHaveBeenCalledTimes(1);
    const rows = sqlite.prepare("SELECT source, source_ref, amount_cents FROM funding_credits").all() as { source: string; source_ref: string; amount_cents: number }[];
    expect(rows).toEqual([{ source: 'celebrity', source_ref: 'pitch:vc:founders-fund:2026-10-08', amount_cents: Number(pitchPayoutCents(6)) }]);
  });
  it('an angel already paid by the one-tap celeb cheque cannot be pitched for a second cheque', async () => {
    const { db } = ledger();
    await recordFundingCredit(db, { deviceId: 'dev-1', source: 'celebrity', sourceRef: 'ada-angel', label: 'Ada', amountCents: 100n, now: NOON_PT });
    const d = realDeps(db);
    expect(await runPitch(angel, 'Pitch', 'sent', NOON_PT, d)).toEqual({ status: 'blocked', reason: 'cooldown' });
    expect(d.judge).not.toHaveBeenCalled();
  });

  // Critic Q1 (orchestrator 2026-10-15): the ladder's FIRST pitch (Pear VC Pre-seed) pays at least $2,000 on any score.
  const pear: PitchTarget = { kind: 'vc', id: FOUNDER_PLAZA_VC_ID, name: FOUNDER_PLAZA_VC_NAME };
  const zero = () => vi.fn<PitchDeps['judge']>(async () => judgeReply('{"score": 0, "verdict": "Not a fit for this fund."}'));
  it('first pitch: only the plaza Pre-seed pitch of a device that never pitched gets the $2,000 minimum', () => {
    expect(FIRST_PITCH_MIN_CENTS).toBe(200_000n);
    expect(founderFirstPitchMin(FOUNDER_PLAZA_VC_ID, undefined, undefined, false)).toBe(200_000n);
    expect(founderFirstPitchMin(FOUNDER_PLAZA_VC_ID, undefined, undefined, true)).toBeUndefined();      // later pitches unchanged
    expect(founderFirstPitchMin(FOUNDER_SEED_VC_ID, FOUNDER_SEED_VC_ID, undefined, false)).toBeUndefined(); // the Seed pitch
    expect(founderFirstPitchMin(FOUNDER_PLAZA_VC_ID, FOUNDER_PLAZA_VC_ID, undefined, false)).toBeUndefined(); // explicit vcId route
    expect(founderFirstPitchMin(FOUNDER_PLAZA_VC_ID, undefined, 'some-meme', false)).toBeUndefined();     // meme pitch
  });
  it('first pitch: a zero score still pays >= $2,000 with a positive line; once paid, the device has pitched and the repeat is a cooldown', async () => {
    const { db, sqlite } = ledger(), d = realDeps(db, zero());
    expect(await devicePitchedBefore(db, 'dev-1')).toBe(false);
    const min = founderFirstPitchMin(pear.id, undefined, undefined, await devicePitchedBefore(db, 'dev-1'));
    const first = await runPitch(pear, 'Uber for sourdough.', 'sent', NOON_PT, d, undefined, min);
    expect(first).toMatchObject({ status: 'judged', credited: true, score: 0 });
    const paid = BigInt((first as { amountCents: string }).amountCents);
    expect(paid >= 200_000n && paid === (pitchPayoutCents(0) > 200_000n ? pitchPayoutCents(0) : 200_000n)).toBe(true);
    if (pitchPayoutCents(0) <= 0n) expect((first as { verdict: string }).verdict).not.toMatch(/Not a fit/);
    expect(await devicePitchedBefore(db, 'dev-1')).toBe(true);
    // Same day: cooldown (idempotent, no second credit). Next day: no longer "first", so a zero score pays the plain cheque.
    expect(await runPitch(pear, 'Again', 'sent', NOON_PT + 60_000, d, undefined, founderFirstPitchMin(pear.id, undefined, undefined, await devicePitchedBefore(db, 'dev-1')))).toEqual({ status: 'blocked', reason: 'cooldown' });
    const nextDay = await runPitch(pear, 'Again', 'sent', NOON_PT + 86_400_000, d, undefined, founderFirstPitchMin(pear.id, undefined, undefined, await devicePitchedBefore(db, 'dev-1')));
    expect(nextDay).toMatchObject({ status: 'judged', amountCents: pitchPayoutCents(0).toString() });
    expect((sqlite.prepare("SELECT COUNT(*) AS n FROM funding_credits").get() as { n: number }).n).toBe(2);
  });
  it('first pitch minimum raises a smaller cheque to the minimum (economy-independent)', async () => {
    const { db } = ledger(), d = realDeps(db, zero()), min = pitchPayoutCents(0) + 123n;
    expect(await runPitch(pear, 'Uber for sourdough.', 'sent', NOON_PT, d, undefined, min)).toMatchObject({ status: 'judged', credited: true, amountCents: min.toString() });
  });
  it('first pitch minimum never lowers a bigger cheque', async () => {
    const { db } = ledger(), d = realDeps(db, vi.fn<PitchDeps['judge']>(async () => judgeReply('{"score": 10, "verdict": "Yes."}')));
    const out = await runPitch(pear, 'Strong pitch', 'sent', NOON_PT, d, undefined, 1n);
    expect(out).toMatchObject({ amountCents: pitchPayoutCents(10).toString(), verdict: 'Yes.' });
  });
});


describe('roaming angels (pure schedule shared by client and server)', async () => {
  const { angelSpots, ANGEL_SLOT_MS, ROAMING_ANGELS } = await import('@gtasf/shared/content/angels');
  const { ANGEL_STOPS } = await import('@gtasf/shared/content/angelStops');
  it('deterministic, distinct stops per slot, reshuffles at the slot boundary', () => {
    const t = NOON_PT - (NOON_PT % ANGEL_SLOT_MS);
    const a = angelSpots(t), b = angelSpots(t + ANGEL_SLOT_MS - 1), c = angelSpots(t + ANGEL_SLOT_MS);
    expect(a).toEqual(b);
    expect(a).toHaveLength(Math.min(ROAMING_ANGELS.length, ANGEL_STOPS.length));
    expect(new Set(a.map(s => s.stop.placeId)).size).toBe(a.length);
    expect(c.map(s => s.stop.placeId)).not.toEqual(a.map(s => s.stop.placeId));
    for (const s of a) expect(() => pitchCredit({ kind: 'angel', id: s.angel.id, name: s.angel.name }, t)).not.toThrow();
  });
  it('a player at an angel\'s stop resolves to that angel', () => {
    const [first] = angelSpots(NOON_PT);
    const spots = angelSpots(NOON_PT).map(s => ({ kind: 'angel' as const, id: s.angel.id, name: s.angel.name, x: s.stop.x, z: s.stop.z }));
    expect(pitchTargetNear(first!.stop.x + 2, first!.stop.z, spots)?.id).toBe(first!.angel.id);
  });
  it('no stops or a bad clock -> no angels', () => {
    expect(angelSpots(NOON_PT, [])).toEqual([]);
    expect(angelSpots(Number.NaN)).toEqual([]);
  });
});

describe('founder-ladder plaza pitch target', () => {
  it('resolves to the real plaza VC firm, as a "vc" target (persona "a partner at <firm>")', () => {
    const spot = founderPlazaSpot();
    expect(spot).toBeDefined();
    expect(spot!.kind).toBe('vc');
    expect(spot!.id).toBe(FOUNDER_PLAZA_VC_ID);
    expect(spot!.name).toBe(FOUNDER_PLAZA_VC_NAME);
    expect(Number.isFinite(spot!.x)).toBe(true);
    expect(Number.isFinite(spot!.z)).toBe(true);
  });

  it('a player on the plaza can pitch that VC within the VC radius', () => {
    const spot = founderPlazaSpot()!;
    const target = pitchTargetNear(spot.x + 2, spot.z + 2, [spot]);
    expect(target).toEqual({ kind: 'vc', id: spot.id, name: spot.name });
    // Out of VC range -> no target.
    expect(pitchTargetNear(spot.x + PITCH_VC_RADIUS_M + 5, spot.z, [spot])).toBeUndefined();
  });
});

describe('founderPitchTarget (scripted card-pitch targets)', () => {
  it('no vcId resolves to the plaza VC (Pre-seed)', () => {
    expect(founderPitchTarget()).toEqual(founderPlazaSpot());
    expect(founderPitchTarget(null)).toEqual(founderPlazaSpot());
  });
  it('the Seed VC id resolves to that firm at its OWN place (not the plaza)', () => {
    const seed = founderPitchTarget(FOUNDER_SEED_VC_ID);
    expect(seed).toBeDefined();
    expect(seed!.kind).toBe('vc');
    expect(seed!.id).toBe(FOUNDER_SEED_VC_ID);
    expect(seed!.name).toBe(FOUNDER_SEED_VC_NAME);
    // It sits at the firm's office, distinct from the Ferry-plaza spot.
    expect(seed!.x !== founderPlazaSpot()!.x || seed!.z !== founderPlazaSpot()!.z).toBe(true);
  });
  it('rejects any other firm id (no card-pitching arbitrary VC offices)', () => {
    expect(founderPitchTarget('a16z')).toBeUndefined();
    expect(founderPitchTarget('nope')).toBeUndefined();
  });
  it('both scripted VC ids are real pitchVcs firms (takedown removes the target)', () => {
    expect(PITCH_VCS.some(v => v.id === FOUNDER_PLAZA_VC_ID && v.name === FOUNDER_PLAZA_VC_NAME)).toBe(true);
    expect(PITCH_VCS.some(v => v.id === FOUNDER_SEED_VC_ID && v.name === FOUNDER_SEED_VC_NAME)).toBe(true);
  });
});
