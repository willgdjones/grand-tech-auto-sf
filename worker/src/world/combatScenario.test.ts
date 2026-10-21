/**
 * GTA V pivot — LANE B: end-to-end SERVER combat-flow proof (gtasf-combat). Stitches the real server-authoritative
 * units in the exact sequence a PvP kill runs through WorldDO — fire → HIT → damage → death → -2% valuation penalty
 * (against a real in-memory SQLite with the production migrations) → respawn target → wanted rising → SFPD unit
 * spawning — so the whole chain is proven deterministically, without a flaky local worker/browser harness. This is
 * the "server flow" evidence the enable gate asks for; the per-unit tests (combat/police/penalty/wanted) cover edges.
 */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

// Death cost is only spendable under economy v3 (prod force-on via prepare.ts); flip it for the debit path.
vi.mock('@gtasf/shared/flags', async (orig) => {
  const actual = await orig<typeof import('@gtasf/shared/flags')>();
  return { ...actual, flags: { ...actual.flags, economyV3: true } };
});

import { FUNDING_SEASON } from '@gtasf/shared/funding';
import { MAX_HEALTH, SF_GENERAL_RESPAWN } from '@gtasf/shared/combat/economy';
import { nearestHospital } from '@gtasf/shared/combat/respawn';
import { project } from '../funding/anchors';
import { addHeat, freshWanted, wantedLevel } from '@gtasf/shared/combat/wanted';
import { WEAPON_ORDER } from '@gtasf/shared/combat/weapons';
import { WorldCombat, type CombatTarget } from './combat';
import { WorldPolice, type RoadSnap } from './police';
import { applyCombatPenalty } from '../funding/penalty';

const MIGRATIONS = ['0010_funding.sql', '0014_funding_bonus.sql', '0018_fund_drops.sql', '0020_funding_credits.sql',
  '0021_referral_reward_amount.sql', '0028_economy_v3.sql', '0030_robotaxi_fares.sql', '0031_economy_reset_epoch.sql',
  '0042_combat_penalties.sql'];
const NOW = Date.UTC(2026, 9, 14, 3, 0, 0);
const PISTOL = WEAPON_ORDER.indexOf('pistol'); // 22 dmg / 60 m / 300 ms
const flatRoad: RoadSnap = (x, z) => ({ x, y: 0, z, yaw: 0 });

function freshDb(): { sqlite: DatabaseSync; db: D1Database } {
  const sqlite = new DatabaseSync(':memory:');
  for (const m of MIGRATIONS) sqlite.exec(readFileSync(new URL(`../../migrations/${m}`, import.meta.url), 'utf8'));
  const db = {
    prepare(sql: string) {
      const statement = sqlite.prepare(sql);
      let bindings: (string | number | null)[] = [];
      const wrapper = {
        bind(...values: (string | number | null)[]) { bindings = values; return wrapper; },
        async first() { return statement.get(...bindings) ?? null; },
        async all() { return { results: statement.all(...bindings), success: true }; },
        async run() { return { meta: statement.run(...bindings), success: true }; },
      };
      return wrapper;
    },
    async batch(statements: { run(): Promise<unknown> }[]) {
      sqlite.exec('BEGIN');
      try { const out = statements.map(s => s.run()); sqlite.exec('COMMIT'); return await Promise.all(out); }
      catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    },
  } as unknown as D1Database;
  return { sqlite, db };
}
function seedPlayer(sqlite: DatabaseSync, deviceId: string, currentCents: number): void {
  sqlite.prepare('INSERT INTO funding_profiles(device_id,token_hash,startup_name,nickname,created_at,updated_at) VALUES(?,?,?,?,?,?)')
    .run(deviceId, `hash-${deviceId}`, `Startup ${deviceId}`, deviceId, NOW, NOW);
  sqlite.prepare('INSERT INTO funding_awards(id,device_id,season,event_id,event_title,day,entered_at,awarded_at,amount_cents,quote_json) VALUES(?,?,?,?,?,?,?,?,?,?)')
    .run(`aw-${deviceId}`, deviceId, FUNDING_SEASON, `evt-${deviceId}`, 'Seed round', '2026-10-14', NOW, NOW, currentCents, '{}');
  sqlite.prepare('UPDATE funding_profiles SET economy_v3_current_cents=?, economy_v3_lifetime_cents=?, economy_v3_burn_updated_at=? WHERE device_id=?')
    .run(currentCents, currentCents, NOW, deviceId);
}
const balance = (sqlite: DatabaseSync, deviceId: string): number =>
  (sqlite.prepare('SELECT economy_v3_current_cents AS c FROM funding_profiles WHERE device_id=?').get(deviceId) as { c: number }).c;

describe('combat server flow (two players): fire → HIT → death → -2% → respawn + wanted + SFPD', () => {
  it('runs the whole authoritative chain end to end', async () => {
    const log: string[] = [];
    const combat = new WorldCombat();
    const police = new WorldPolice(flatRoad, () => 0.5);
    const { sqlite, db } = freshDb();

    const SHOOTER = 1, VICTIM = 2, VICTIM_DEVICE = 'dev-victim';
    seedPlayer(sqlite, VICTIM_DEVICE, 10_000_000); // $100,000 valuation
    const before = balance(sqlite, VICTIM_DEVICE);
    log.push(`victim valuation before: $${(before / 100).toLocaleString()}`);

    // Shooter at origin, victim 10 m east at chest height, in pistol range + on the aim line.
    const shooterPoseCm = { x: 0, y: 0, z: 0 };
    const victimTarget = (): CombatTarget[] => [{ id: VICTIM, x: 10, y: 1.4, z: 0 }];
    let wanted = freshWanted();
    let killed = false, shots = 0;

    // Fire the pistol at the weapon cadence (300 ms) until the victim is wasted.
    for (let t = NOW; !killed && shots < 8; t += 300) {
      const r = combat.fire(SHOOTER, shooterPoseCm, { weapon: PISTOL, dir: [1, 0, 0] }, victimTarget(), t);
      if (!r || r.targetId !== VICTIM) continue;
      shots++;
      wanted = addHeat(wanted, r.killed ? 'ped-kill' : 'assault', t); // WorldDO raises assault per hit, ped-kill on the kill
      killed = r.killed;
      log.push(`shot ${shots}: HIT victim for ${r.damage} → health ${r.health}${r.killed ? ' (WASTED)' : ''}`);
    }
    expect(killed).toBe(true);
    expect(combat.healthOf(VICTIM)).toBe(0);
    expect(shots).toBe(Math.ceil(MAX_HEALTH / 22)); // 5 pistol rounds

    // Death cost: the victim loses exactly 2% (server-minted srv: incident id), idempotent.
    const penalty = await applyCombatPenalty(db, VICTIM_DEVICE, `srv:${'x'.repeat(8)}`, 'wasted', NOW);
    expect(penalty).toMatchObject({ ok: true, kind: 'wasted', costCents: '200000', currentCents: '9800000' });
    if (!penalty.ok) throw new Error('penalty failed'); // narrow the result union for the log below
    expect(balance(sqlite, VICTIM_DEVICE)).toBe(9_800_000);
    log.push(`victim valuation after WASTED (-2%): $${(balance(sqlite, VICTIM_DEVICE) / 100).toLocaleString()} (−$${(Number(penalty.costCents) / 100).toLocaleString()})`);

    // Respawn target (WorldDO.respawnAt road-snaps + CORRECTIONs the victim here): SF General by default; with
    // nearestHospitalRespawn (critic N20) the nearest hospital to the death, via the worker's own projection.
    expect(SF_GENERAL_RESPAWN).toMatchObject({ lat: expect.any(Number), lon: expect.any(Number) });
    const ferry = project(37.7955, -122.3937), mission = project(37.7599, -122.4148);
    const fromFerry = nearestHospital(ferry, project), fromMission = nearestHospital(mission, project);
    const km = (a: { x: number; z: number }, h: { lat: number; lon: number }) => { const p = project(h.lat, h.lon); return Math.hypot(p.x - a.x, p.z - a.z) / 1000; };
    expect(fromFerry.id).not.toBe('sf-general');
    expect(km(ferry, fromFerry)).toBeLessThan(km(ferry, SF_GENERAL_RESPAWN));
    expect(km(ferry, fromFerry)).toBeLessThan(3.3);
    expect(fromMission.id).toBe('sf-general');
    log.push(`victim respawns at the nearest hospital: a Ferry death -> ${fromFerry.name} (${km(ferry, fromFerry).toFixed(1)} km, SF General ${km(ferry, SF_GENERAL_RESPAWN).toFixed(1)} km); a Mission death -> ${fromMission.name}`);

    // The kill raised the shooter's wanted level.
    const level = wantedLevel(wanted.heat);
    expect(level).toBeGreaterThanOrEqual(1);
    log.push(`shooter wanted: ${wanted.heat} heat → ${level} stars`);

    // SFPD respond: a pursuit unit spawns on the wanted shooter.
    // gtasf-66lvh: after the dispatch delay (the cops aren't already standing there).
    for (let i = 0; i < 40; i++) police.update(0.1, [{ id: SHOOTER, x: 0, y: 0, z: 0, level }]);
    expect(police.count).toBeGreaterThanOrEqual(1);
    log.push(`SFPD dispatched: ${police.count} pursuit unit(s) on the shooter`);

    console.log('\n[combat server flow]\n  ' + log.join('\n  ') + '\n');
  });
});
