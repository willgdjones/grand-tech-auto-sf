/**
 * WorldDO orchestration for live street races (flag streetRaces; the pure rules are founder/streetRace.ts). Holds the
 * in-memory races, sends QUEST events, and posts each finisher's SERVER-measured time to the route's daily time-trial
 * board. No valuation. Races are transient: a DO eviction simply ends them (nothing owed).
 */
import { encodeS2C } from '@gtasf/shared/protocol/s2c';
import type { Pose } from '@gtasf/shared/protocol/types';
import { timeTrialById, type TimeTrialSpec } from '@gtasf/shared/founder/timeTrials';
import type { QuestEvent } from '@gtasf/shared/founder/questEvents';
import { project } from '../funding/anchors';
import { flags } from '@gtasf/shared/flags';
import {
  RACE_INVITE_RADIUS_M, RACE_JOIN_RADIUS_M, RACE_JOIN_WINDOW_MS, advanceRacer, createRace, dropRacer, joinRace,
  npcFinishes, placings, raceGates, tickRace, type Gate, type StreetRace,
} from '../founder/streetRace';

export interface RacePeer {
  readonly id: number;
  readonly pose: Pose;
  readonly fundingDeviceId?: string;
  readonly session: { readonly id: number; readonly generation: number; readonly name: string };
  send(bytes: Uint8Array): void;
}
export interface StreetRaceDeps {
  peers(): Iterable<RacePeer>;
  inVehicle(peerId: number): boolean;
  /** Post a finisher's server-measured time to the route's daily board (best-of); fire-and-forget. */
  recordBoard(device: string, routeId: string, ms: number): void;
  newId(): string;
}
export type HostResult = { status: 'hosting'; raceId: string; closesInMs: number } | { status: 'too-far' | 'busy' | 'no-route' };
export type JoinRaceResult = { status: 'joined'; raceId: string } | { status: 'too-far' | 'busy' | 'no-race' | 'closed' | 'full' | 'already' };

const metres = (pose: Pose) => ({ x: pose.x / 100, z: pose.z / 100 });

export class WorldStreetRaces {
  private readonly races = new Map<string, { race: StreetRace; spec: TimeTrialSpec; gates: Gate[] }>();
  /** sid → raceId, for the pose hook and drops. */
  private readonly bySid = new Map<number, string>();
  constructor(private readonly deps: StreetRaceDeps) {}

  private send(sids: Iterable<number>, event: QuestEvent): void {
    const want = new Set(sids), bytes = encodeS2C({ type: 'QUEST', json: JSON.stringify(event) });
    for (const p of this.deps.peers()) if (want.has(p.session.id)) p.send(bytes);
  }
  private nearStart(peer: RacePeer, spec: TimeTrialSpec, radius: number): boolean {
    const s = project(spec.start.lat, spec.start.lon), m = metres(peer.pose);
    return Math.hypot(m.x - s.x, m.z - s.z) <= radius;
  }

  host(peer: RacePeer, routeId: string, now: number): HostResult {
    const spec = timeTrialById(routeId);
    if (!spec || !peer.fundingDeviceId) return { status: 'no-route' };
    if (this.bySid.has(peer.session.id)) return { status: 'busy' };
    if (!this.nearStart(peer, spec, RACE_JOIN_RADIUS_M)) return { status: 'too-far' };
    const id = this.deps.newId();
    const race = createRace(id, spec.id, { sid: peer.session.id, gen: peer.session.generation, device: peer.fundingDeviceId, name: peer.session.name }, now);
    this.races.set(id, { race, spec, gates: raceGates(spec, project) });
    this.bySid.set(peer.session.id, id);
    const invitees: number[] = [];
    for (const p of this.deps.peers()) if (p.session.id !== peer.session.id && !this.bySid.has(p.session.id) && this.nearStart(p, spec, RACE_INVITE_RADIUS_M)) invitees.push(p.session.id);
    this.send(invitees, { kind: 'race-invite', raceId: id, routeId: spec.id, host: peer.session.name, joinInMs: RACE_JOIN_WINDOW_MS });
    this.lobby(id, now);
    return { status: 'hosting', raceId: id, closesInMs: RACE_JOIN_WINDOW_MS };
  }

  join(peer: RacePeer, raceId: string, now: number): JoinRaceResult {
    const entry = this.races.get(raceId);
    if (!entry || !peer.fundingDeviceId) return { status: 'no-race' };
    if (this.bySid.has(peer.session.id)) return { status: 'busy' };
    if (!this.nearStart(peer, entry.spec, RACE_JOIN_RADIUS_M)) return { status: 'too-far' };
    const result = joinRace(entry.race, { sid: peer.session.id, gen: peer.session.generation, device: peer.fundingDeviceId, name: peer.session.name }, now);
    if (result !== 'ok') return { status: result };
    this.bySid.set(peer.session.id, raceId);
    this.lobby(raceId, now);
    return { status: 'joined', raceId };
  }

  private lobby(raceId: string, now: number): void {
    const { race } = this.races.get(raceId)!;
    this.send(race.racers.map(r => r.sid), { kind: 'race-lobby', raceId, routeId: race.routeId, racers: race.racers.map(r => r.name),
      closesInMs: Math.max(0, race.createdAt + RACE_JOIN_WINDOW_MS - now) });
  }

  /** Per server tick: advance each race's clock and emit its transitions. */
  step(now: number): void {
    for (const [id, { race, spec }] of this.races) {
      for (const rival of npcFinishes(race, now)) { // raceRivals: an NPC crossed the line on its predetermined time
        const place = race.racers.filter(r => r.finishMs !== null).length;
        this.send(race.racers.filter(r => r.npcMs === undefined).map(r => r.sid), { kind: 'race-finish', raceId: id, name: rival.name, place, ms: rival.finishMs! });
      }
      const event = tickRace(race, spec.parMs, now, flags.raceRivals ? { minMs: spec.minMs, seed: [...id].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0, 2166136261) } : undefined);
      if (!event) continue;
      const humans = race.racers.filter(r => !r.dnf && r.npcMs === undefined).map(r => r.sid);
      const sids = humans;
      const rivals = race.racers.filter(r => r.npcMs !== undefined).map(r => ({ name: r.name, ms: r.npcMs! }));
      if (event.kind === 'countdown') this.send(sids, { kind: 'race-countdown', raceId: id, routeId: race.routeId, startsInMs: Math.max(0, event.startAt - now), ...(rivals.length ? { rivals } : {}) });
      else if (event.kind === 'go') this.send(sids, { kind: 'race-go', raceId: id, routeId: race.routeId });
      else if (event.kind === 'cancelled') { this.send(race.racers.map(r => r.sid), { kind: 'race-cancelled', raceId: id, reason: event.reason }); this.end(id); }
      else if (event.kind === 'done') this.finish(id);
    }
  }

  private finish(raceId: string): void {
    const entry = this.races.get(raceId); if (!entry) return;
    const result = placings(entry.race);
    for (const r of entry.race.racers) {
      if (r.npcMs !== undefined) continue; // rivals have no socket
      const you = result.find(p => p.sid === r.sid)?.place ?? null;
      this.send([r.sid], { kind: 'race-results', raceId, routeId: entry.race.routeId, placings: result.map(({ name, ms, place }) => ({ name, ms, place })), you });
    }
    this.end(raceId);
  }
  private end(raceId: string): void {
    const entry = this.races.get(raceId); if (!entry) return;
    for (const r of entry.race.racers) if (r.npcMs === undefined && this.bySid.get(r.sid) === raceId) this.bySid.delete(r.sid);
    this.races.delete(raceId);
  }

  /** Every server-accepted pose: count the racer's next gate / finish (server clock + authoritative pose). */
  onPose(peer: RacePeer, now: number): void {
    const raceId = this.bySid.get(peer.session.id); if (!raceId) return;
    const entry = this.races.get(raceId); if (!entry) return;
    const racer = entry.race.racers.find(r => r.sid === peer.session.id);
    if (!racer || racer.gen !== peer.session.generation) { dropRacer(entry.race, peer.session.id); return; } // resumed session: DNF
    const m = metres(peer.pose);
    const result = advanceRacer(entry.race, entry.spec, entry.gates, peer.session.id, m.x, m.z, this.deps.inVehicle(peer.id), now);
    if (!result) return;
    if (result.kind === 'gate') this.send([peer.session.id], { kind: 'race-gate', raceId, reached: result.reached, total: entry.gates.length });
    else {
      const place = entry.race.racers.filter(r => r.finishMs !== null).length;
      this.send(entry.race.racers.map(r => r.sid), { kind: 'race-finish', raceId, name: racer.name, place, ms: result.ms });
      this.deps.recordBoard(racer.device, entry.race.routeId, result.ms);
    }
  }

  /** A device teleported / disconnected / resumed: its racers are DNF (or leave the lobby). */
  dropDevice(device: string): void {
    for (const [raceId, entry] of this.races) for (const r of entry.race.racers) if (r.device === device) {
      dropRacer(entry.race, r.sid);
      if (this.bySid.get(r.sid) === raceId) this.bySid.delete(r.sid);
    }
  }
  get size(): number { return this.races.size; }
}
