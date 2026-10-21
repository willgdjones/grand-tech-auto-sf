/**
 * GTASF live street races (flag streetRaces, lane C multiplayer quest 1). A player hosts a race at a time-trial 'T'
 * marker; nearby players are invited and may join for RACE_JOIN_WINDOW_MS; then a server countdown; each racer passes
 * the route's gates IN ORDER (server-accepted poses only) and finishes on the server clock. Placings = server finish
 * order. Prize: bragging rights + the racer's time posted to the route's daily time-trial board — no valuation.
 *
 * Anti-cheat: gates are tracked from the AUTHORITATIVE pose, in order; a finish below the route's anti-teleport floor
 * (spec.minMs) doesn't count; the mode must match (a drive route is raced in a vehicle, a foot route on foot); any
 * server-authorized teleport / disconnect makes that racer DNF (WorldDO clearDeviceQuests). Pure: no I/O, no clock.
 */
import type { TimeTrialSpec } from '@gtasf/shared/founder/timeTrials';

export const RACE_JOIN_WINDOW_MS = 30_000;
export const RACE_COUNTDOWN_MS = 5_000;
/** Join / host only within this distance of the route's start marker. */
export const RACE_JOIN_RADIUS_M = 60;
/** Players within this distance of the start get the invite. */
export const RACE_INVITE_RADIUS_M = 400;
export const RACE_MIN_RACERS = 2;
export const RACE_MAX_RACERS = 8;
/** A race ends this many pars after the start (stragglers DNF). */
export const RACE_TIMEOUT_PARS = 3;

export interface Racer {
  readonly sid: number;
  readonly gen: number;
  readonly device: string;
  readonly name: string;
  /** Gates passed in order (route checkpoints, then the finish). */
  reached: number;
  finishMs: number | null;
  dnf: boolean;
  /** raceRivals: an NPC rival's predetermined finish time (server clock from the start). Absent for players. */
  readonly npcMs?: number;
}
export type RaceState = 'lobby' | 'countdown' | 'running' | 'done' | 'cancelled';
export interface StreetRace {
  readonly id: string;
  readonly routeId: string;
  readonly hostSid: number;
  readonly createdAt: number;
  /** When the clock starts (end of the countdown); null in the lobby. */
  startAt: number | null;
  state: RaceState;
  readonly racers: Racer[];
}
export interface Gate { readonly x: number; readonly z: number; readonly radiusM: number }

export function createRace(id: string, routeId: string, host: Omit<Racer, 'reached' | 'finishMs' | 'dnf'>, now: number): StreetRace {
  return { id, routeId, hostSid: host.sid, createdAt: now, startAt: null, state: 'lobby', racers: [{ ...host, reached: 0, finishMs: null, dnf: false }] };
}

export type JoinResult = 'ok' | 'closed' | 'full' | 'already';
export function joinRace(race: StreetRace, racer: Omit<Racer, 'reached' | 'finishMs' | 'dnf'>, now: number): JoinResult {
  if (race.state !== 'lobby' || now > race.createdAt + RACE_JOIN_WINDOW_MS) return 'closed';
  if (race.racers.some(r => r.sid === racer.sid || r.device === racer.device)) return 'already';
  if (race.racers.length >= RACE_MAX_RACERS) return 'full';
  race.racers.push({ ...racer, reached: 0, finishMs: null, dnf: false });
  return 'ok';
}

/** raceRivals (critique: multiplayer features must work in an empty cell): fictional rivals who fill a race nobody
 *  else joined. Each has a predetermined finish time around the route's par (one quick, one about par, one slow, a
 *  little seeded jitter), never below the route's anti-teleport floor. They never post to the board; no valuation. */
export const RACE_RIVALS: readonly { name: string; parX: number }[] = [
  { name: 'Chad (Series B, owns a Rivian)', parX: 0.9 },
  { name: 'Your YC batchmate', parX: 1.0 },
  { name: 'A stealth-mode prototype', parX: 1.12 },
];
export function addRivals(race: StreetRace, parMs: number, minMs: number, seed: number): void {
  RACE_RIVALS.forEach((rival, i) => {
    if (race.racers.length >= RACE_MAX_RACERS) return;
    const jitter = (((seed >>> (i * 5)) & 31) - 15) / 500; // ±3 %
    race.racers.push({ sid: -(i + 1), gen: 0, device: `npc:${i}`, name: rival.name, reached: 0, finishMs: null, dnf: false,
      npcMs: Math.max(minMs, Math.round(parMs * (rival.parX + jitter))) });
  });
}
/** Rivals whose time has come (running races): mark them finished and return them, in finish order. */
export function npcFinishes(race: StreetRace, now: number): Racer[] {
  if (race.state !== 'running' || race.startAt === null) return [];
  const due = race.racers.filter(r => r.npcMs !== undefined && r.finishMs === null && !r.dnf && now - race.startAt! >= r.npcMs);
  due.sort((a, b) => a.npcMs! - b.npcMs!);
  for (const r of due) r.finishMs = r.npcMs!;
  return due;
}

export type TickEvent = { kind: 'countdown'; startAt: number } | { kind: 'go' } | { kind: 'cancelled'; reason: 'no-rivals' | 'empty' } | { kind: 'done' };
/** Advance the race clock. Lobby → countdown when the join window closes (with ≥ RACE_MIN_RACERS live racers, else
 *  cancelled); countdown → running at startAt; running → done when every racer finished/DNF or the timeout passed. */
export function tickRace(race: StreetRace, parMs: number, now: number, rivals?: { minMs: number; seed: number }): TickEvent | null {
  const live = race.racers.filter(r => !r.dnf);
  if (race.state === 'lobby') {
    if (!live.length) { race.state = 'cancelled'; return { kind: 'cancelled', reason: 'empty' }; }
    if (now < race.createdAt + RACE_JOIN_WINDOW_MS) return null;
    if (live.length < RACE_MIN_RACERS) {
      if (!rivals) { race.state = 'cancelled'; return { kind: 'cancelled', reason: 'no-rivals' }; }
      addRivals(race, parMs, rivals.minMs, rivals.seed); // nobody joined: race the NPC rivals instead of cancelling
    }
    race.state = 'countdown'; race.startAt = now + RACE_COUNTDOWN_MS;
    return { kind: 'countdown', startAt: race.startAt };
  }
  if (race.state === 'countdown' && race.startAt !== null && now >= race.startAt) { race.state = 'running'; return { kind: 'go' }; }
  if (race.state === 'running' && race.startAt !== null) {
    const timedOut = now > race.startAt + parMs * RACE_TIMEOUT_PARS;
    if (timedOut) for (const r of race.racers) if (r.finishMs === null) r.dnf = true;
    // Every PLAYER is done: the rivals' times are already fixed, so settle them now rather than make people wait.
    if (!timedOut && race.racers.every(r => r.npcMs !== undefined || r.dnf || r.finishMs !== null))
      for (const r of race.racers) if (r.npcMs !== undefined && r.finishMs === null && !r.dnf) r.finishMs = r.npcMs;
    if (timedOut || race.racers.every(r => r.dnf || r.finishMs !== null)) { race.state = 'done'; return { kind: 'done' }; }
  }
  return null;
}

/** The ordered gates of a route: its checkpoints, then the finish (positions from the caller's projection). */
export function raceGates(spec: TimeTrialSpec, project: (lat: number, lon: number) => { x: number; z: number }): Gate[] {
  return [...spec.checkpoints, spec.finish].map(g => ({ ...project(g.at.lat, g.at.lon), radiusM: g.radiusM }));
}

export type AdvanceResult = { kind: 'gate'; reached: number } | { kind: 'finished'; ms: number } | null;
/** Feed one server-accepted pose (metres) for a racer. Counts the NEXT gate only (in order); the last gate finishes the
 *  race if the mode matches and the server-measured time is at or above the route's floor. */
export function advanceRacer(race: StreetRace, spec: TimeTrialSpec, gates: readonly Gate[], sid: number, x: number, z: number, inVehicle: boolean, now: number): AdvanceResult {
  if (race.state !== 'running' || race.startAt === null) return null;
  const racer = race.racers.find(r => r.sid === sid);
  if (!racer || racer.dnf || racer.finishMs !== null) return null;
  if ((spec.mode === 'drive') !== inVehicle) return null; // wrong mode: gates don't count (drive in a car, sprint on foot)
  const gate = gates[racer.reached];
  if (!gate || Math.hypot(x - gate.x, z - gate.z) > gate.radiusM) return null;
  if (racer.reached === gates.length - 1) {
    const ms = now - race.startAt;
    if (ms < spec.minMs) return null; // faster than humanly possible on this route: a teleport, never a finish
    racer.reached += 1; racer.finishMs = ms;
    return { kind: 'finished', ms };
  }
  racer.reached += 1;
  return { kind: 'gate', reached: racer.reached };
}

/** A racer left (teleport, disconnect, resume): DNF if racing, dropped from a lobby. */
export function dropRacer(race: StreetRace, sid: number): void {
  const i = race.racers.findIndex(r => r.sid === sid);
  if (i < 0) return;
  if (race.state === 'lobby') race.racers.splice(i, 1); else race.racers[i]!.dnf = true;
}

export interface Placing { readonly sid: number; readonly name: string; readonly ms: number | null; readonly place: number | null }
/** Finishers by server time (ties by earlier gate order = array order), then DNFs unplaced. */
export function placings(race: StreetRace): Placing[] {
  const finished = race.racers.filter(r => r.finishMs !== null).sort((a, b) => a.finishMs! - b.finishMs!);
  const out: Placing[] = finished.map((r, i) => ({ sid: r.sid, name: r.name, ms: r.finishMs, place: i + 1 }));
  for (const r of race.racers) if (r.finishMs === null) out.push({ sid: r.sid, name: r.name, ms: null, place: null });
  return out;
}
