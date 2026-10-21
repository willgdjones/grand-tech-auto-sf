import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { countCaption, countVoice, countVoiceDevice, purgeVoiceMetricSalts, voiceReport } from './metrics';

function freshDb() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../../migrations/0039_voice_metrics.sql', import.meta.url), 'utf8'));
  const prepare = (sql: string) => {
    const statement = sqlite.prepare(sql); let bindings: (string | number | null)[] = [];
    const wrapper = { bind(...values: (string | number | null)[]) { bindings = values; return wrapper; },
      async first<T>() { return (statement.get(...bindings) ?? null) as T; },
      async all<T>() { return { results: statement.all(...bindings) as T[], success: true }; },
      async run() { const meta = statement.run(...bindings); return { meta: { changes: Number(meta.changes) }, success: true }; } };
    return wrapper;
  };
  return { sqlite, db: { prepare } as unknown as D1Database };
}
// 19:00 UTC = noon PT on Oct 6; the PT day rolls at 07:00 UTC.
const NOON_PT = Date.parse('2026-10-06T19:00:00Z'), DAY = 86_400_000;

describe('voice metrics (no PII)', () => {
  it('counts caption attempts by outcome and unique speaking devices per Pacific day', async () => {
    const { db } = freshDb();
    await countCaption(db, 'sent', 'dev-a', NOON_PT);
    await countCaption(db, 'sent', 'dev-a', NOON_PT + 60_000);
    await countCaption(db, 'empty', 'dev-b', NOON_PT);
    await countCaption(db, 'refused-budget', 'dev-c', NOON_PT);
    await countCaption(db, 'sent', 'dev-a', NOON_PT + DAY); // next day
    const report = await voiceReport(db, 7, NOON_PT + DAY);
    expect(report.counts.filter(r => r.day === '2026-10-06')).toEqual([
      { day: '2026-10-06', metric: 'caption', outcome: 'empty', count: 1 },
      { day: '2026-10-06', metric: 'caption', outcome: 'refused-budget', count: 1 },
      { day: '2026-10-06', metric: 'caption', outcome: 'sent', count: 2 },
    ]);
    expect(report.devices).toEqual([
      { day: '2026-10-06', metric: 'caption_speaker', devices: 3 },
      { day: '2026-10-07', metric: 'caption_speaker', devices: 1 },
    ]);
  });

  it('keys by Pacific day, not UTC (23:30 PT still counts for that PT day)', async () => {
    const { db } = freshDb();
    await countVoice(db, 'voice_session', 'created', Date.parse('2026-10-07T06:30:00Z')); // 23:30 PT Oct 6
    expect((await voiceReport(db, 2, NOON_PT)).counts).toEqual([{ day: '2026-10-06', metric: 'voice_session', outcome: 'created', count: 1 }]);
  });

  it('stores no device id: hashes use a per-day salt, and finished days lose their salt', async () => {
    const { sqlite, db } = freshDb();
    await countVoiceDevice(db, 'voice_optin', 'dev-secret', NOON_PT);
    await countVoiceDevice(db, 'voice_optin', 'dev-secret', NOON_PT + DAY);
    const hashes = sqlite.prepare('SELECT hash FROM voice_metric_devices').all() as { hash: string }[];
    expect(hashes).toHaveLength(2);
    expect(hashes[0]!.hash).not.toBe(hashes[1]!.hash); // same device, different day: unlinkable
    expect(JSON.stringify(sqlite.prepare('SELECT * FROM voice_metric_devices').all())).not.toContain('dev-secret');
    expect(await purgeVoiceMetricSalts(db, NOON_PT + 3 * DAY)).toBe(2);
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM voice_metric_salt').get()).toEqual({ n: 0 });
    // Counts survive the salt purge.
    expect((await voiceReport(db, 7, NOON_PT + 3 * DAY)).devices.map(d => d.devices)).toEqual([1, 1]);
  });

  it('never throws when the tables are missing (metrics are best-effort)', async () => {
    const db = new DatabaseSync(':memory:');
    const broken = { prepare: (sql: string) => { const s = db.prepare(sql); return { bind: () => ({ run: async () => s.run(), first: async () => s.get() }) }; } } as unknown as D1Database;
    await expect(countCaption(broken, 'sent', 'dev', NOON_PT)).resolves.toBeUndefined();
  });
});
