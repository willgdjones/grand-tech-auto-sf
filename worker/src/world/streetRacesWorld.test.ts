import { describe, expect, it, vi } from 'vitest';
import { decodeS2C } from '@gtasf/shared/protocol/s2c';
import { parseQuestEvent, type QuestEvent } from '@gtasf/shared/founder/questEvents';
import { timeTrialById } from '@gtasf/shared/founder/timeTrials';
import { project } from '../funding/anchors';
import { RACE_COUNTDOWN_MS, RACE_JOIN_WINDOW_MS, raceGates } from '../founder/streetRace';
import { WorldStreetRaces, type RacePeer } from './streetRaces';
import { flags } from '@gtasf/shared/flags';

// A mutable copy so each test can pin raceRivals.
vi.mock('@gtasf/shared/flags', async importOriginal => ({ flags: { ...(await importOriginal<typeof import('@gtasf/shared/flags')>()).flags } }));
const setRivals = (on: boolean) => { (flags as { raceRivals: boolean }).raceRivals = on; };

const SPEC = timeTrialById('telegraph-hill-climb')!;
const GATES = raceGates(SPEC, project);
const startPose = (dx = 0) => { const s = project(SPEC.start.lat, SPEC.start.lon); return { x: Math.round((s.x + dx) * 100), y: 0, z: Math.round(s.z * 100), yaw: 0, flags: 0 }; };
const gatePose = (i: number) => ({ x: Math.round(GATES[i]!.x * 100), y: 0, z: Math.round(GATES[i]!.z * 100), yaw: 0, flags: 0 });

function world() {
  const inbox = new Map<number, QuestEvent[]>();
  const peers: (RacePeer & { pose: RacePeer['pose'] })[] = [];
  const add = (sid: number, pose: RacePeer['pose'], device = `d${sid}`) => {
    inbox.set(sid, []);
    const p = { id: sid, pose, fundingDeviceId: device, session: { id: sid, generation: 1, name: `P${sid}` },
      send: (bytes: Uint8Array) => { const d = decodeS2C(bytes); if (d.ok && d.msg.type === 'QUEST') inbox.get(sid)!.push(parseQuestEvent(d.msg.json)!); } };
    peers.push(p); return p;
  };
  const recordBoard = vi.fn();
  const races = new WorldStreetRaces({ peers: () => peers, inVehicle: () => false, newId: () => 'race1', recordBoard });
  return { races, add, inbox, recordBoard };
}
const kinds = (events: QuestEvent[]) => events.map(e => e.kind);

describe('WorldStreetRaces (WorldDO orchestration)', () => {
  it('hosting needs the start marker; invites go to nearby idle players only', () => {
    const { races, add, inbox } = world();
    const host = add(1, startPose()), near = add(2, startPose(100)), far = add(3, startPose(5_000));
    expect(races.host(add(4, startPose(500)), SPEC.id, 0)).toEqual({ status: 'too-far' });
    expect(races.host(host, SPEC.id, 0)).toMatchObject({ status: 'hosting', raceId: 'race1' });
    expect(kinds(inbox.get(2)!)).toEqual(['race-invite']);
    expect(inbox.get(3)).toEqual([]);
    expect(kinds(inbox.get(1)!)).toEqual(['race-lobby']);
    expect(races.host(host, SPEC.id, 1)).toEqual({ status: 'busy' });
    void near; void far;
  });
  it('join → lobby update to all; countdown → GO; gates and finish from poses; finish posts the server time', () => {
    const { races, add, inbox, recordBoard } = world();
    const host = add(1, startPose()), rival = add(2, startPose(20));
    races.host(host, SPEC.id, 0);
    expect(races.join(rival, 'race1', 1_000)).toEqual({ status: 'joined', raceId: 'race1' });
    expect((inbox.get(1)!.at(-1) as { racers: string[] }).racers).toEqual(['P1', 'P2']);
    races.step(RACE_JOIN_WINDOW_MS);
    expect(inbox.get(2)!.at(-1)).toMatchObject({ kind: 'race-countdown', startsInMs: RACE_COUNTDOWN_MS });
    const go = RACE_JOIN_WINDOW_MS + RACE_COUNTDOWN_MS;
    races.step(go);
    expect(inbox.get(1)!.at(-1)?.kind).toBe('race-go');
    rival.pose = gatePose(0); races.onPose(rival, go + 5_000);
    expect(inbox.get(2)!.at(-1)).toMatchObject({ kind: 'race-gate', reached: 1, total: GATES.length });
    rival.pose = gatePose(1); races.onPose(rival, go + SPEC.minMs + 1_000);
    expect(inbox.get(1)!.at(-1)).toMatchObject({ kind: 'race-finish', name: 'P2', place: 1, ms: SPEC.minMs + 1_000 });
    expect(recordBoard).toHaveBeenCalledWith('d2', SPEC.id, SPEC.minMs + 1_000);
    races.dropDevice('d1'); // host teleports: DNF → race done
    races.step(go + SPEC.minMs + 2_000);
    const results = inbox.get(2)!.at(-1) as Extract<QuestEvent, { kind: 'race-results' }>;
    expect(results.kind).toBe('race-results');
    expect(results.you).toBe(1);
    expect(results.placings).toEqual([{ name: 'P2', ms: SPEC.minMs + 1_000, place: 1 }, { name: 'P1', ms: null, place: null }]);
    expect(races.size).toBe(0);
  });
  it('a lone host is told the race was cancelled (raceRivals off)', () => {
    setRivals(false);
    const { races, add, inbox } = world();
    races.host(add(1, startPose()), SPEC.id, 0);
    races.step(RACE_JOIN_WINDOW_MS);
    expect(inbox.get(1)!.at(-1)).toMatchObject({ kind: 'race-cancelled', reason: 'no-rivals' });
    expect(races.size).toBe(0);
  });
  it('raceRivals: a lone host races three NPC rivals; their finishes reach the player; results place everyone', () => {
    setRivals(true);
    const { races, add, inbox, recordBoard } = world();
    const p1 = add(1, startPose());
    races.host(p1, SPEC.id, 0);
    races.step(RACE_JOIN_WINDOW_MS);
    const countdown = inbox.get(1)!.at(-1)!;
    expect(countdown).toMatchObject({ kind: 'race-countdown' });
    const rivals = (countdown as { rivals?: { name: string; ms: number }[] }).rivals!;
    expect(rivals).toHaveLength(3);
    const go = RACE_JOIN_WINDOW_MS + RACE_COUNTDOWN_MS;
    races.step(go);
    const fastest = Math.min(...rivals.map(r => r.ms));
    races.step(go + fastest);
    expect(inbox.get(1)!.at(-1)).toMatchObject({ kind: 'race-finish', place: 1, ms: fastest });
    // The player finishes last (after every rival).
    const slowest = Math.max(...rivals.map(r => r.ms));
    for (const r of rivals) races.step(go + r.ms);
    p1.pose = gatePose(0); races.onPose(p1, go + slowest + 100);
    p1.pose = gatePose(1); races.onPose(p1, go + slowest + 200);
    races.step(go + slowest + 300);
    const results = inbox.get(1)!.at(-1) as Extract<QuestEvent, { kind: 'race-results' }>;
    expect(results.kind).toBe('race-results');
    expect(results.you).toBe(4);
    expect(results.placings.map(p => p.place)).toEqual([1, 2, 3, 4]);
    expect(recordBoard).toHaveBeenCalledTimes(1); // only the player posts to the board
    expect(races.size).toBe(0);
  });
});
