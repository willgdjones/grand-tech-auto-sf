import { describe, expect, it, vi } from 'vitest';
import { missionById, missionCheckpoints, missionCredit, missionPayoutCents } from '@gtasf/shared/founder/missions';
import { project } from '../funding/anchors';
import { advanceCheckpoints, missionDoneNow, missionsDoneNow, runMission, missionCompleted, missionMinTravelMs, questStartedBy, type MissionCompletion, type MissionDeps } from './missions';

const heist = missionById('steal-pitch-deck')!;
const NOW = 1_760_000_000_000;
const FLOOR = missionMinTravelMs(heist);
/** A legitimate delivery: at the point, after a plausible travel time, heat lost (or wanted off). */
const pass = (over: Partial<MissionCompletion> = {}): MissionCompletion => ({ atDelivery: true, elapsedMs: FLOOR + 60_000, wantedStars: 0, checkpointsReached: missionCheckpoints(heist).length, ...over });

function deps(over: Partial<MissionDeps> = {}): MissionDeps & { credited: ReturnType<typeof vi.fn>; award: ReturnType<typeof vi.fn> } {
  const credited = vi.fn(async () => false);
  const award = vi.fn(async () => ({ credited: true }));
  return { credited, award, ...over } as never;
}

describe('missionMinTravelMs', () => {
  it('is a real, non-trivial floor for the heist (grab SoMa → deliver FiDi is ~2km)', () => {
    expect(FLOOR).toBeGreaterThan(20_000); // ~28s at 70 m/s over the ~1.95km straight line
    expect(FLOOR).toBeLessThan(60_000);    // but well under any real multi-minute city drive
  });
});

describe('missionCompleted (anti-cheat predicate)', () => {
  it('passes a legit delivery (at the point, plausible time, 0 stars)', () => {
    expect(missionCompleted(heist, pass())).toBe(true);
  });
  it('rejects a delivery when the authoritative pose is not at the point', () => {
    expect(missionCompleted(heist, pass({ atDelivery: false }))).toBe(false);
  });
  it('rejects an impossibly fast delivery (teleport into the radius)', () => {
    expect(missionCompleted(heist, pass({ elapsedMs: 2_000 }))).toBe(false);
    expect(missionCompleted(heist, pass({ elapsedMs: FLOOR - 1 }))).toBe(false);
  });
  it('rejects a heist delivered with the heat still on (stars > 0)', () => {
    expect(missionCompleted(heist, pass({ wantedStars: 3 }))).toBe(false);
    expect(missionCompleted(heist, pass({ wantedStars: 1 }))).toBe(false);
  });
  it('allows a heist delivery when the wanted system is off (nothing to enforce)', () => {
    expect(missionCompleted(heist, pass({ wantedStars: null }))).toBe(true);
  });
});

describe('questStartedBy (resume-bypass guard)', () => {
  const entry = { sid: 7, gen: 3 };
  const peer = (id: number, generation: number) => ({ session: { id, generation } });
  it('accepts the exact session that started the quest (same id + generation)', () => {
    expect(questStartedBy(entry, peer(7, 3))).toBe(true);
  });
  it('rejects a resumed session: a ?at= reload keeps the id but bumps the generation', () => {
    expect(questStartedBy(entry, peer(7, 4))).toBe(false); // generation++ on resume → not the starter
  });
  it('rejects a different session id, and a missing peer', () => {
    expect(questStartedBy(entry, peer(8, 3))).toBe(false);
    expect(questStartedBy(entry, undefined)).toBe(false);
  });
});

describe('runMission', () => {
  it('pays a server-validated completion once, with the mission credit ref + economy-scaled payout', async () => {
    const d = deps();
    const out = await runMission(heist, pass(), NOW, d);
    expect(out).toEqual({ status: 'completed', credited: true, amountCents: missionPayoutCents(heist).toString() });
    const { source, sourceRef } = missionCredit(heist, NOW);
    expect(d.award).toHaveBeenCalledOnce();
    expect(d.award.mock.calls[0]![0]).toMatchObject({ source, sourceRef, amountCents: missionPayoutCents(heist).toString() });
  });

  it('does not pay (and does not touch the ledger) when the server has not confirmed completion', async () => {
    const d = deps();
    expect(await runMission(heist, pass({ atDelivery: false }), NOW, d)).toEqual({ status: 'incomplete' });
    expect(d.award).not.toHaveBeenCalled();
    expect(d.credited).not.toHaveBeenCalled();
  });

  it('does not pay a teleported (impossibly fast) delivery — no ledger touch', async () => {
    const d = deps();
    expect(await runMission(heist, pass({ elapsedMs: 1_500 }), NOW, d)).toEqual({ status: 'incomplete' });
    expect(d.award).not.toHaveBeenCalled();
    expect(d.credited).not.toHaveBeenCalled();
  });

  it('does not pay a heist delivered while still wanted', async () => {
    const d = deps();
    expect(await runMission(heist, pass({ wantedStars: 2 }), NOW, d)).toEqual({ status: 'incomplete' });
    expect(d.award).not.toHaveBeenCalled();
  });

  it('blocks a repeat within the cooldown window without awarding again', async () => {
    const d = deps({ credited: vi.fn(async () => true) });
    expect(await runMission(heist, pass(), NOW, d)).toEqual({ status: 'blocked', reason: 'cooldown' });
    expect(d.award).not.toHaveBeenCalled();
  });

  it('reports credited:false if the ledger loses a write race (completed, not double-counted)', async () => {
    const d = deps({ award: vi.fn(async () => ({ credited: false })) });
    const out = await runMission(heist, pass(), NOW, d);
    expect(out).toMatchObject({ status: 'completed', credited: false });
  });
});

describe('server-verified checkpoints (cofounder-hunt loop)', () => {
  const hunt = missionById('cofounder-hunt')!;
  const at = (i: number) => { const o = missionCheckpoints(hunt)[i]!.at!; return project(o.lat, o.lon); };
  it('the heist has one checkpoint (the grab) that its start pose already satisfies', () => {
    expect(missionCheckpoints(heist).map(o => o.id)).toEqual(['grab']);
    const start = project(heist.start.lat, heist.start.lon);
    expect(advanceCheckpoints(heist, 0, start.x, start.z)).toBe(1);
  });
  it('counts pickups only in order, and the loop floor covers the whole path (start == delivery)', () => {
    expect(missionCheckpoints(hunt).map(o => o.id)).toEqual(['rust', 'designer', 'staff-eng']);
    const start = project(hunt.start.lat, hunt.start.lon);
    expect(advanceCheckpoints(hunt, 0, start.x, start.z)).toBe(0);
    expect(advanceCheckpoints(hunt, 0, at(1).x, at(1).z)).toBe(0); // skipping ahead never counts
    expect(advanceCheckpoints(hunt, 0, at(0).x, at(0).z)).toBe(1);
    expect(advanceCheckpoints(hunt, 1, at(1).x, at(1).z)).toBe(2);
    expect(advanceCheckpoints(hunt, 2, at(2).x, at(2).z)).toBe(3);
    expect(missionMinTravelMs(hunt)).toBeGreaterThan(20_000); // ~2 km loop, not ~0 from start→delivery
  });
  it('pays only once every pickup was seen by the server', () => {
    const floor = missionMinTravelMs(hunt);
    const done = { atDelivery: true, elapsedMs: floor + 1, wantedStars: null, checkpointsReached: 3 };
    expect(missionCompleted(hunt, done)).toBe(true);
    expect(missionCompleted(hunt, { ...done, checkpointsReached: 2 })).toBe(false);
    expect(missionCompleted(hunt, { ...done, elapsedMs: floor - 1 })).toBe(false); // instant start→return claim
  });
});

describe('cooldown at start (missionDoneNow / missionsDoneNow)', () => {
  it('a daily job paid today is done today, not tomorrow; disabled missions never list', () => {
    const today = new Set([missionCredit(heist, NOW).sourceRef]);
    expect(missionDoneNow(heist, today, NOW)).toBe(true);
    expect(missionDoneNow(heist, today, NOW + 86_400_000)).toBe(false);
    expect(missionDoneNow(heist, new Set(), NOW)).toBe(false);
    const hunt = missionById('cofounder-hunt')!;
    const both = new Set([missionCredit(heist, NOW).sourceRef, missionCredit(hunt, NOW).sourceRef]);
    expect(missionsDoneNow(both, NOW, { cofounderHunt: true })).toEqual(['steal-pitch-deck', 'cofounder-hunt']);
    expect(missionsDoneNow(both, NOW, { cofounderHunt: false })).toEqual(['steal-pitch-deck']);
  });
});

describe('taxi fare (taxiFareJob): drive objectives only count from the driver seat', () => {
  const fare = missionById('taxi-fare')!;
  const stand = project(fare.objectives[0]!.at!.lat, fare.objectives[0]!.at!.lon);
  it('is a daily fare whose pickup + drop-off are both drive objectives, with a real travel floor', () => {
    expect(fare.cooldown).toBe('daily');
    expect(fare.objectives.every(o => o.drive)).toBe(true);
    expect(missionCheckpoints(fare).map(o => o.id)).toEqual(['pickup']);
    expect(missionMinTravelMs(fare)).toBeGreaterThan(20_000); // Ferry → Union Square is ~1.6 km
  });
  it('the pickup does not count on foot (the start pose sits on it), only once driving', () => {
    expect(advanceCheckpoints(fare, 0, stand.x, stand.z)).toBe(0);
    expect(advanceCheckpoints(fare, 0, stand.x, stand.z, false)).toBe(0);
    expect(advanceCheckpoints(fare, 0, stand.x + 3, stand.z, true)).toBe(1);
  });
  it('other missions are unaffected by the driving argument', () => {
    const hunt = missionById('cofounder-hunt')!, rust = project(hunt.objectives[0]!.at!.lat, hunt.objectives[0]!.at!.lon);
    expect(advanceCheckpoints(hunt, 0, rust.x, rust.z, false)).toBe(1);
    expect(advanceCheckpoints(hunt, 0, rust.x, rust.z, true)).toBe(1);
  });
});
