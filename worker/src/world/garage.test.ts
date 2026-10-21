import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';
import { garageSlotsForRound } from '@gtasf/shared/garage';
import { giftTierCars, keepCar, listGarage } from './garage';
import { savePersonalCar } from './personalCar';

// Pin the legacy round -> look-tier mapping (economyV3 swaps it for star counts).
vi.mock('@gtasf/shared/flags', async importOriginal => {
  const actual = await importOriginal<typeof import('@gtasf/shared/flags')>();
  return { flags: { ...actual.flags, economyV3: false, garageSlots: true } };
});

const round = (id: string) => ({ id });
function db() {
  const sqlite = new DatabaseSync(':memory:');
  for (const file of ['0051_personal_cars.sql', '0054_garage.sql']) sqlite.exec(readFileSync(new URL(`../../migrations/${file}`, import.meta.url), 'utf8'));
  const d1 = { prepare(sql: string) { const st = sqlite.prepare(sql); let b: (string | number)[] = [];
    const w = { bind(...v: (string | number)[]) { b = v; return w; }, async first() { return st.get(...b) ?? null; },
      async all() { return { results: st.all(...b) }; }, async run() { st.run(...b); return {}; } }; return w; } } as unknown as D1Database;
  return { sqlite, d1 };
}

it('slots grow with the look tier: 1 at Bootstrapping, 2 at Pre-seed/Seed, 3 at Series A, 4 from Series D (capped)', () => {
  expect(garageSlotsForRound(round('bootstrapping'))).toBe(1);
  expect(garageSlotsForRound(round('pre-seed'))).toBe(2);
  expect(garageSlotsForRound(round('seed'))).toBe(2);
  expect(garageSlotsForRound(round('series-a'))).toBe(3);
  expect(garageSlotsForRound(round('series-d'))).toBe(4);
  expect(garageSlotsForRound(round('decacorn'))).toBe(4);
});

it('keep: civilian road cars only, slot 1+ within the round, and the stored row comes back [2][4][6]', async () => {
  const { d1 } = db();
  expect(await keepCar(d1, 'dev', 1, 'bus', round('seed'), 1)).toEqual({ status: 'rejected', reason: 'kind' });
  expect(await keepCar(d1, 'dev', 1, 'robotaxi', round('seed'), 1)).toEqual({ status: 'rejected', reason: 'kind' });
  expect(await keepCar(d1, 'dev', 0, 'tesla', round('seed'), 1)).toEqual({ status: 'rejected', reason: 'slot' }); // slot 0 = auto-save
  expect(await keepCar(d1, 'dev', 2, 'tesla', round('seed'), 1)).toEqual({ status: 'rejected', reason: 'slot' }); // Seed has 2 slots
  expect(await keepCar(d1, 'dev', 1, 'tesla', round('bootstrapping'), 1)).toEqual({ status: 'rejected', reason: 'slot' });
  expect(await keepCar(d1, 'dev', 1, 'tesla', round('seed'), 5)).toMatchObject({ status: 'kept', car: { slot: 1, kind: 'tesla', source: 'kept', savedAt: 5 } });
  // Replacing the slot (a second tab, or a later keep) returns what the server now holds.
  expect(await keepCar(d1, 'dev', 1, 'supercar', round('seed'), 9)).toMatchObject({ status: 'kept', car: { slot: 1, kind: 'supercar', savedAt: 9 } });
});

it('list: slot 0 is the personal car; a car above a lower round\'s count is kept but hidden, never deleted [4][7]', async () => {
  const { d1, sqlite } = db();
  await savePersonalCar(d1, 'dev', 'prius', { x: 1, y: 2, z: 3, yaw: 4, flags: 0 }, 1);
  await keepCar(d1, 'dev', 2, 'tesla', round('series-a'), 2);
  const high = await listGarage(d1, 'dev', round('series-a'));
  expect(high.slots).toBe(3);
  expect(high.cars).toEqual([
    { slot: 0, kind: 'prius', source: 'personal', savedAt: 1, hidden: false },
    { slot: 2, kind: 'tesla', source: 'kept', savedAt: 2, hidden: false },
  ]);
  const low = await listGarage(d1, 'dev', round('seed')); // the valuation fell back a round
  expect(low.cars.find(car => car.slot === 2)).toMatchObject({ kind: 'tesla', hidden: true });
  expect(sqlite.prepare('SELECT COUNT(*) AS n FROM garage_cars').get()).toEqual({ n: 1 });
  expect(sqlite.prepare('SELECT COUNT(*) AS n FROM personal_cars').get()).toEqual({ n: 1 }); // slot 0 table untouched
});

it('tier gifts: each reached tier once per device, replay-safe, into its own slot [5]', async () => {
  const { d1, sqlite } = db();
  let n = 0; const ref = () => `ref-${++n}`;
  expect(await giftTierCars(d1, 'dev', round('bootstrapping'), 1, ref)).toEqual([]); // no gift at tier 0
  expect(await giftTierCars(d1, 'dev', round('series-a'), 2, ref)).toEqual([
    { tier: 1, slot: 1, kind: 'prius' }, { tier: 2, slot: 2, kind: 'tesla' },
  ]);
  expect(await giftTierCars(d1, 'dev', round('series-a'), 3, ref)).toEqual([]); // replay: nothing new
  expect(sqlite.prepare('SELECT COUNT(*) AS n FROM garage_gifts').get()).toEqual({ n: 2 });
  expect((await listGarage(d1, 'dev', round('series-a'))).cars.map(car => [car.slot, car.kind, car.source, car.tier])).toEqual([[1, 'prius', 'gift', 1], [2, 'tesla', 'gift', 2]]); // the phone names the tier
});

it('a tier gift another tab already gave is skipped; a gift waits when every slot is full [5]', async () => {
  const { d1, sqlite } = db();
  // Another tab won tier 1 a moment ago (different ref): this call must not place a second car.
  sqlite.prepare('INSERT INTO garage_gifts (device_id, tier, slot, ref, given_at) VALUES (?,?,?,?,?)').run('dev', 1, 1, 'other-tab', 1);
  expect(await giftTierCars(d1, 'dev', round('seed'), 2, () => 'mine')).toEqual([]);
  // Full at Seed (slot 1 kept): the tier-1 gift for a fresh device waits, then lands at Series A in the new slot.
  await keepCar(d1, 'dev2', 1, 'subaru', round('seed'), 3);
  expect(await giftTierCars(d1, 'dev2', round('seed'), 4, () => 'a')).toEqual([]);
  expect(sqlite.prepare('SELECT COUNT(*) AS n FROM garage_gifts WHERE device_id=?').get('dev2')).toEqual({ n: 0 });
  let n = 0;
  expect(await giftTierCars(d1, 'dev2', round('series-a'), 5, () => `b${++n}`)).toEqual([{ tier: 1, slot: 2, kind: 'prius' }]);
});

it('reviewer LOW: a keep that fills the slot between the gift claim and the car insert releases the claim (no false gift)', async () => {
  const { d1, sqlite } = db();
  // Wrap the store: right after the gift row is claimed, a same-device keep fills slot 1 (the race).
  const racy = { prepare(sql: string) { const st = d1.prepare(sql);
    if (!/INSERT OR IGNORE INTO garage_gifts/.test(sql)) return st;
    const bound = { bind(...v: unknown[]) { const inner = (st as unknown as { bind(...a: unknown[]): { run(): Promise<unknown> } }).bind(...v);
      return { async run() { const r = await inner.run();
        sqlite.prepare('INSERT OR REPLACE INTO garage_cars (device_id, slot, kind, source, saved_at) VALUES (?,?,?,?,?)').run('dev', 1, 'subaru', 'kept', 99); return r; } }; } };
    return bound; } } as unknown as D1Database;
  expect(await giftTierCars(racy, 'dev', round('seed'), 5, () => 'g1')).toEqual([]); // not announced
  expect(sqlite.prepare('SELECT COUNT(*) AS n FROM garage_gifts').get()).toEqual({ n: 0 }); // claim released: it can retry
  expect(sqlite.prepare("SELECT kind, source FROM garage_cars WHERE slot=1").get()).toEqual({ kind: 'subaru', source: 'kept' });
  // Later, with a free slot (Series A), the Seed gift lands.
  expect(await giftTierCars(d1, 'dev', round('series-a'), 6, () => 'g2')).toEqual([{ tier: 1, slot: 2, kind: 'prius' }]); // the Series A gift waits: no free slot left
});
