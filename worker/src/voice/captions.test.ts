import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  attachReportCaptions, billableSeconds, CAPTION_MAX_BYTES, PITCH_MAX_BYTES, PITCH_MAX_SECONDS, reconcileCaptionSeconds, releaseCaptionSeconds, CAPTION_BURST, CAPTION_DAILY_SECONDS, CAPTION_IP_MAX, CAPTION_REFILL_MS, CaptionRing,
  captionDeviceBudget, captionIpBudget, purgeReportCaptions, recordCaptionStrike, reserveCaptionSeconds,
} from './captions';
import { voiceBanned } from './store';
import type { Env } from '../env';

// index.ts (scheduled()) pulls in the Durable Object classes; stub the runtime base class for Node.
vi.mock('cloudflare:workers', () => ({ DurableObject: class { constructor(public ctx: unknown, public env: unknown) {} }, WorkerEntrypoint: class {} }));

function freshDb() {
  const sqlite = new DatabaseSync(':memory:');
  for (const m of ['0011_referrals.sql', '0034_voice.sql', '0038_voice_captions.sql']) sqlite.exec(readFileSync(new URL(`../../migrations/${m}`, import.meta.url), 'utf8'));
  const prepare = (sql: string) => {
    const statement = sqlite.prepare(sql); let bindings: (string | number | null)[] = [];
    const wrapper = { bind(...values: (string | number | null)[]) { bindings = values; return wrapper; },
      async first() { return statement.get(...bindings) ?? null; },
      async all() { return { results: statement.all(...bindings), success: true }; },
      async run() { return { meta: statement.run(...bindings), success: true }; } };
    return wrapper;
  };
  return { sqlite, db: { prepare } as unknown as D1Database };
}
const NOON_PT = Date.parse('2026-10-06T19:00:00Z');

describe('spoken bubble budgets', () => {
  it('device bucket: burst then one clip per refill interval', async () => {
    const { db } = freshDb();
    for (let i = 0; i < CAPTION_BURST; i++) expect(await captionDeviceBudget(db, 'd', NOON_PT)).toBe(true);
    expect(await captionDeviceBudget(db, 'd', NOON_PT)).toBe(false);
    expect(await captionDeviceBudget(db, 'other', NOON_PT)).toBe(true); // per device
    expect(await captionDeviceBudget(db, 'd', NOON_PT + CAPTION_REFILL_MS)).toBe(true);
    expect(await captionDeviceBudget(db, 'd', NOON_PT + CAPTION_REFILL_MS)).toBe(false);
  });
  it('per-IP cap holds across rotating devices', async () => {
    const { db } = freshDb();
    for (let i = 0; i < CAPTION_IP_MAX; i++) expect(await captionIpBudget(db, '203.0.113.9', NOON_PT)).toBe(true);
    expect(await captionIpBudget(db, '203.0.113.9', NOON_PT)).toBe(false);
    expect(await captionIpBudget(db, '198.51.100.1', NOON_PT)).toBe(true);
  });
  it('reserves 1..8 s from the larger of the reported length and a size estimate (never trusts the client alone)', () => {
    expect([billableSeconds(.2), billableSeconds(3.5), billableSeconds(30), billableSeconds(Number.NaN)]).toEqual([1, 3.5, 8, 8]);
    expect(billableSeconds(1, 8_000)).toBe(2);              // 8 KB at the 32 kbps floor = 2 s, though the client said 1 s
    expect(billableSeconds(1, CAPTION_MAX_BYTES)).toBe(8);   // a max-size upload reserves the full 8 s
    // Pitch clips (flags.pitching + X-GTASF-Pitch): up to 15 s on the same meter; a max-size pitch reserves 15 s.
    expect([billableSeconds(30, 0, PITCH_MAX_SECONDS), billableSeconds(Number.NaN, 0, PITCH_MAX_SECONDS), billableSeconds(12, 0, PITCH_MAX_SECONDS)]).toEqual([15, 15, 12]);
    expect(billableSeconds(1, PITCH_MAX_BYTES, PITCH_MAX_SECONDS)).toBe(15);
  });
});

describe('daily spend cap ($20/day)', () => {
  it('reserves up to the cap, then pauses and counts the overflow; a new SF day starts fresh', async () => {
    const { sqlite, db } = freshDb(); const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(CAPTION_DAILY_SECONDS).toBe(Math.floor(20 / (0.00051 * 60) * 3600)); // $20 at $0.00051/min ≈ 653 h
    expect(await reserveCaptionSeconds(db, 6, NOON_PT, 10)).toBe(true);
    expect(await reserveCaptionSeconds(db, 4, NOON_PT, 10)).toBe(true);   // exactly at the cap
    expect(await reserveCaptionSeconds(db, 1, NOON_PT, 10)).toBe(false);  // paused
    expect(await reserveCaptionSeconds(db, 1, NOON_PT, 10)).toBe(false);
    expect(sqlite.prepare('SELECT seconds,refused FROM voice_caption_spend').get()).toEqual({ seconds: 10, refused: 2 });
    expect(warn).toHaveBeenCalled();
    expect(await reserveCaptionSeconds(db, 1, NOON_PT + 86_400_000, 10)).toBe(true); // next day
    expect(await reserveCaptionSeconds(db, 11, NOON_PT + 2 * 86_400_000, 10)).toBe(false); // a clip bigger than the cap never reserves
    warn.mockRestore();
  });
});

describe('provider-measured billing (gtasf-wd9h)', () => {
  it('charges the measured length above the reservation, so a low-bitrate long clip still pauses captions', async () => {
    const { sqlite, db } = freshDb(); const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await reserveCaptionSeconds(db, 1, NOON_PT, 60)).toBe(true);           // client claimed 1 s
    expect(await reconcileCaptionSeconds(db, 1, 55, NOON_PT)).toBe(55);           // provider heard 55 s
    expect(sqlite.prepare('SELECT seconds FROM voice_caption_spend').get()).toEqual({ seconds: 55 });
    expect(await reserveCaptionSeconds(db, 8, NOON_PT, 60)).toBe(false);          // 55 + 8 > 60: paused
    expect(await reconcileCaptionSeconds(db, 8, 3, NOON_PT)).toBe(8);             // shorter than reserved: no refund
    expect(await reconcileCaptionSeconds(db, 8, undefined, NOON_PT)).toBe(8);     // unknown: keep the reservation
    warn.mockRestore();
  });
  it('a refused/failed transcription releases its reservation (an unpaid provider account cannot exhaust the day)', async () => {
    const { sqlite, db } = freshDb();
    for (let i = 0; i < 5; i++) { expect(await reserveCaptionSeconds(db, 8, NOON_PT, 20)).toBe(true); await releaseCaptionSeconds(db, 8, NOON_PT); }
    expect(sqlite.prepare('SELECT seconds FROM voice_caption_spend').get()).toEqual({ seconds: 0 });
    await releaseCaptionSeconds(db, 50, NOON_PT);                                   // never negative
    expect(sqlite.prepare('SELECT seconds FROM voice_caption_spend').get()).toEqual({ seconds: 0 });
  });
});

describe('moderation strikes', () => {
  it('three rejected captions within an hour ban voice for 24 h; older strikes expire', async () => {
    const { db } = freshDb();
    expect((await recordCaptionStrike(db, 'spk', NOON_PT)).banned).toBe(false);
    expect((await recordCaptionStrike(db, 'spk', NOON_PT + 3_700_000)).banned).toBe(false); // first one is now > 1 h old
    expect((await recordCaptionStrike(db, 'spk', NOON_PT + 3_701_000)).banned).toBe(false);
    expect(await voiceBanned(db, 'spk', NOON_PT + 3_702_000)).toBe(false);
    expect((await recordCaptionStrike(db, 'spk', NOON_PT + 3_702_000)).banned).toBe(true);
    expect(await voiceBanned(db, 'spk', NOON_PT + 3_702_000 + 86_000_000)).toBe(true);
    expect(await voiceBanned(db, 'spk', NOON_PT + 3_702_000 + 86_500_000)).toBe(false);
  });
});

describe('report caption ring and retention', () => {
  it('keeps only the last 2 minutes per player, in memory', () => {
    const ring = new CaptionRing();
    ring.add('a', 'old', 0); ring.add('a', 'mid', 60_000); ring.add('b', 'other', 60_000); ring.add('a', 'new', 150_000);
    expect(ring.recent('a', 150_000).map(line => line.text)).toEqual(['mid', 'new']);
    expect(ring.recent('a', 400_000)).toEqual([]);
    ring.forget('b'); expect(ring.recent('b', 60_000)).toEqual([]);
  });
  it('attaches the ring to a report, and the cron purges report transcripts after 7 days', async () => {
    const { sqlite, db } = freshDb();
    expect(await attachReportCaptions(db, 'spk', 'rep', [], NOON_PT)).toBe(false); // nothing to store
    expect(await attachReportCaptions(db, 'spk', 'rep', [{ at: NOON_PT - 1000, text: 'hello there' }], NOON_PT)).toBe(true);
    await attachReportCaptions(db, 'spk', 'rep2', [{ at: NOON_PT, text: 'later' }], NOON_PT + 6 * 86_400_000);
    expect(await purgeReportCaptions(db, NOON_PT + 7 * 86_400_000 + 1)).toBe(1);
    expect(sqlite.prepare('SELECT reporter_device FROM voice_report_captions').all()).toEqual([{ reporter_device: 'rep2' }]);
  });
});

describe('caption purge cron wiring', () => {
  it('the 3-hourly scheduled() run purges expired report transcripts (and the daily run does not)', async () => {
    const { default: worker } = await import('../index');
    const { sqlite, db } = freshDb(), jobs: unknown[] = [];
    const env = { DB: db, JOBS: { send: async (job: unknown) => { jobs.push(job); } } } as unknown as Env;
    vi.useFakeTimers(); vi.setSystemTime(NOON_PT + 8 * 86_400_000);
    try {
      await attachReportCaptions(db, 'spk', 'old', [{ at: NOON_PT, text: 'expired' }], NOON_PT);
      await attachReportCaptions(db, 'spk', 'new', [{ at: NOON_PT, text: 'fresh' }], NOON_PT + 7 * 86_400_000);
      await worker.scheduled!({ cron: '0 8 * * *' } as ScheduledController, env);
      expect(sqlite.prepare('SELECT COUNT(*) AS n FROM voice_report_captions').get()).toEqual({ n: 2 });
      await worker.scheduled!({ cron: '0 */3 * * *' } as ScheduledController, env);
      expect(sqlite.prepare('SELECT reporter_device FROM voice_report_captions').all()).toEqual([{ reporter_device: 'new' }]);
    } finally { vi.useRealTimers(); }
  }, 30_000); // imports the whole Worker entry; slow under shared-laptop load
});
