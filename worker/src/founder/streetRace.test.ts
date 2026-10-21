import { describe, expect, it } from 'vitest';
import { timeTrialById } from '@gtasf/shared/founder/timeTrials';
import { project } from '../funding/anchors';
import {
  RACE_COUNTDOWN_MS, RACE_JOIN_WINDOW_MS, RACE_MAX_RACERS, RACE_RIVALS, RACE_TIMEOUT_PARS, advanceRacer, createRace, dropRacer,
  joinRace, npcFinishes, placings, raceGates, tickRace,
} from './streetRace';

const SPEC = timeTrialById('telegraph-hill-climb')!; // foot route: 1 checkpoint + finish
const GATES = raceGates(SPEC, project);
const T0 = 1_800_000_000_000;
const host = { sid: 1, gen: 1, device: 'd1', name: 'Host' };
const rival = { sid: 2, gen: 1, device: 'd2', name: 'Rival' };
const lobby = () => { const r = createRace('r', SPEC.id, host, T0); joinRace(r, rival, T0 + 1000); return r; };
const started = () => { const r = lobby(); tickRace(r, SPEC.parMs, T0 + RACE_JOIN_WINDOW_MS); tickRace(r, SPEC.parMs, r.startAt!); return r; };
const at = (i: number) => GATES[i]!;

describe('lobby + countdown', () => {
  it('joins within the window only, once per device, up to the cap', () => {
    const r = createRace('r', SPEC.id, host, T0);
    expect(joinRace(r, rival, T0 + 1)).toBe('ok');
    expect(joinRace(r, { ...rival, sid: 9 }, T0 + 2)).toBe('already');           // same device, other tab
    expect(joinRace(r, { sid: 3, gen: 1, device: 'd3', name: 'Late' }, T0 + RACE_JOIN_WINDOW_MS + 1)).toBe('closed');
    const full = createRace('f', SPEC.id, host, T0);
    for (let i = 2; i <= RACE_MAX_RACERS; i++) expect(joinRace(full, { sid: i, gen: 1, device: `d${i}`, name: `P${i}` }, T0)).toBe('ok');
    expect(joinRace(full, { sid: 99, gen: 1, device: 'd99', name: 'X' }, T0)).toBe('full');
  });
  it('a lone host is cancelled when the window closes; two racers get a countdown then GO', () => {
    const solo = createRace('s', SPEC.id, host, T0);
    expect(tickRace(solo, SPEC.parMs, T0 + RACE_JOIN_WINDOW_MS)).toEqual({ kind: 'cancelled', reason: 'no-rivals' });
    const r = lobby();
    expect(tickRace(r, SPEC.parMs, T0 + 5000)).toBeNull();
    expect(tickRace(r, SPEC.parMs, T0 + RACE_JOIN_WINDOW_MS)).toEqual({ kind: 'countdown', startAt: T0 + RACE_JOIN_WINDOW_MS + RACE_COUNTDOWN_MS });
    expect(joinRace(r, { sid: 3, gen: 1, device: 'd3', name: 'Late' }, T0 + RACE_JOIN_WINDOW_MS)).toBe('closed');
    expect(tickRace(r, SPEC.parMs, r.startAt!)).toEqual({ kind: 'go' });
  });
  it('a racer leaving the lobby is dropped; an emptied lobby cancels', () => {
    const r = createRace('r', SPEC.id, host, T0);
    dropRacer(r, 1);
    expect(tickRace(r, SPEC.parMs, T0 + 1)).toEqual({ kind: 'cancelled', reason: 'empty' });
  });
});

describe('gates and finish (server poses)', () => {
  it('gates count only in order and only in the right mode; nothing before GO', () => {
    const pre = lobby();
    expect(advanceRacer(pre, SPEC, GATES, 1, at(0).x, at(0).z, false, T0)).toBeNull(); // not running yet
    const r = started(), t = r.startAt!;
    expect(advanceRacer(r, SPEC, GATES, 1, at(1).x, at(1).z, false, t + 60_000)).toBeNull();   // finish before gate 1
    expect(advanceRacer(r, SPEC, GATES, 1, at(0).x, at(0).z, true, t + 10_000)).toBeNull();    // foot route in a car
    expect(advanceRacer(r, SPEC, GATES, 1, at(0).x, at(0).z, false, t + 10_000)).toEqual({ kind: 'gate', reached: 1 });
  });
  it('a finish faster than the route floor never counts (teleport); a legit one records the server time', () => {
    const r = started(), t = r.startAt!;
    advanceRacer(r, SPEC, GATES, 1, at(0).x, at(0).z, false, t + 5_000);
    expect(advanceRacer(r, SPEC, GATES, 1, at(1).x, at(1).z, false, t + SPEC.minMs - 1)).toBeNull();
    expect(advanceRacer(r, SPEC, GATES, 1, at(1).x, at(1).z, false, t + SPEC.minMs + 500)).toEqual({ kind: 'finished', ms: SPEC.minMs + 500 });
    expect(advanceRacer(r, SPEC, GATES, 1, at(1).x, at(1).z, false, t + SPEC.minMs + 900)).toBeNull(); // only once
  });
  it('placings follow server finish time; a DNF (teleport) is unplaced; done when all are in', () => {
    const r = started(), t = r.startAt!;
    for (const [sid, ms] of [[2, 60_000], [1, 70_000]] as const) {
      advanceRacer(r, SPEC, GATES, sid, at(0).x, at(0).z, false, t + 5_000);
      advanceRacer(r, SPEC, GATES, sid, at(1).x, at(1).z, false, t + ms);
    }
    expect(tickRace(r, SPEC.parMs, t + 70_001)).toEqual({ kind: 'done' });
    expect(placings(r).map(p => [p.name, p.place])).toEqual([['Rival', 1], ['Host', 2]]);
    const d = started(), t2 = d.startAt!;
    dropRacer(d, 1);
    advanceRacer(d, SPEC, GATES, 2, at(0).x, at(0).z, false, t2 + 5_000);
    advanceRacer(d, SPEC, GATES, 2, at(1).x, at(1).z, false, t2 + 60_000);
    expect(advanceRacer(d, SPEC, GATES, 1, at(0).x, at(0).z, false, t2 + 61_000)).toBeNull(); // DNF can't continue
    expect(placings(d)).toEqual([{ sid: 2, name: 'Rival', ms: 60_000, place: 1 }, { sid: 1, name: 'Host', ms: null, place: null }]);
  });
  it('stragglers are DNF at the timeout', () => {
    const r = started(), t = r.startAt!;
    expect(tickRace(r, SPEC.parMs, t + SPEC.parMs * RACE_TIMEOUT_PARS + 1)).toEqual({ kind: 'done' });
    expect(r.racers.every(x => x.dnf)).toBe(true);
  });
});

describe('raceRivals: NPC rivals fill an empty race', () => {
  const RIV = { minMs: SPEC.minMs, seed: 0xdeadbeef };
  const soloStarted = () => {
    const r = createRace('s', SPEC.id, host, T0);
    expect(tickRace(r, SPEC.parMs, T0 + RACE_JOIN_WINDOW_MS, RIV)?.kind).toBe('countdown');
    expect(tickRace(r, SPEC.parMs, r.startAt!, RIV)).toEqual({ kind: 'go' });
    return r;
  };
  it('a lone host races three rivals with fixed times around par, never under the floor, deterministic per seed', () => {
    const r = soloStarted();
    const npcs = r.racers.filter(x => x.npcMs !== undefined);
    expect(npcs.map(x => x.name)).toEqual(RACE_RIVALS.map(x => x.name));
    for (const n of npcs) { expect(n.sid).toBeLessThan(0); expect(n.npcMs!).toBeGreaterThanOrEqual(SPEC.minMs); expect(n.npcMs! / SPEC.parMs).toBeGreaterThan(0.85); expect(n.npcMs! / SPEC.parMs).toBeLessThan(1.16); }
    expect(soloStarted().racers.map(x => x.npcMs)).toEqual(r.racers.map(x => x.npcMs));
    const floor = createRace('f', SPEC.id, host, T0); tickRace(floor, SPEC.parMs, T0 + RACE_JOIN_WINDOW_MS, { minMs: SPEC.parMs * 2, seed: 1 });
    expect(floor.racers.filter(x => x.npcMs !== undefined).every(x => x.npcMs === SPEC.parMs * 2)).toBe(true);
  });
  it('two humans get no rivals', () => {
    const r = lobby(); tickRace(r, SPEC.parMs, T0 + RACE_JOIN_WINDOW_MS, RIV);
    expect(r.racers).toHaveLength(2);
  });
  it('rivals finish on their own clock, in order; the player places among them', () => {
    const r = soloStarted();
    const [fast, mid] = r.racers.filter(x => x.npcMs !== undefined).sort((a, b) => a.npcMs! - b.npcMs!);
    expect(npcFinishes(r, r.startAt! + fast!.npcMs! - 1)).toEqual([]);
    expect(npcFinishes(r, r.startAt! + fast!.npcMs!).map(x => x.name)).toEqual([fast!.name]);
    const myMs = Math.round((fast!.npcMs! + mid!.npcMs!) / 2);
    advanceRacer(r, SPEC, GATES, 1, at(0).x, at(0).z, false, r.startAt! + myMs - 10);
    expect(advanceRacer(r, SPEC, GATES, 1, at(1).x, at(1).z, false, r.startAt! + myMs)).toEqual({ kind: 'finished', ms: myMs });
    // The only player is done: the remaining rivals settle at their fixed times right away.
    expect(tickRace(r, SPEC.parMs, r.startAt! + myMs + 1, RIV)).toEqual({ kind: 'done' });
    const p = placings(r);
    expect(p.find(x => x.sid === 1)?.place).toBe(2);
    expect(p.map(x => x.place)).toEqual([1, 2, 3, 4]);
  });
  it('a player who DNFs still ends the race, rivals placed', () => {
    const r = soloStarted();
    dropRacer(r, 1);
    expect(tickRace(r, SPEC.parMs, r.startAt! + 1, RIV)).toEqual({ kind: 'done' });
    expect(placings(r).filter(x => x.place !== null)).toHaveLength(3);
  });
});
