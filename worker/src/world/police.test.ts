import { SFPD_TUNING } from '@gtasf/shared/combat/sfpdTuning';
import { describe, expect, it } from 'vitest';
import { desiredUnits, HELICOPTER_ALTITUDE_M, POLICE_CHASE_SPEED, HELICOPTER_SIGHT_M, MAX_POLICE_UNITS, POLICE_SIGHT_M, roadblockCount, OFFICER_COVER_HOLD_M, OFFICER_COVER_OFFSET_M, OFFICER_STANDOFF_M, POLICE_FLAG, POLICE_FOOT_STANDOFF_M, POLICE_STANDOFF_M, swatCount } from '@gtasf/shared/combat/police';
import { DEFAULT_PURSUIT_TIMING, INSTANT_PURSUIT_TIMING, OFFICER_ADOPT_PLAYER_Y_M, officerGroundY, WorldPolice as LivePolice, type RoadSnap } from './police';
import { RAM_COOLDOWN_MS } from '@gtasf/shared/combat/policeRam';

// Identity "road snap" (every point is on a road) and a fixed rng so spawn placement is deterministic.
const flatRoad: RoadSnap = (x, z) => ({ x, y: 0, z, yaw: 0 });
const fixedRng = () => 0.5; // angle = π, dist = 75 + 0.5·65 = 107.5 m from the player
// gtasf-66lvh: these behaviour tests use INSTANT dispatch/escalation (every unit on the first tick); the real reaction
// and escalation delays have their own tests at the bottom.
class WorldPolice extends LivePolice {
  constructor(snap: RoadSnap, rng: () => number = Math.random, blocked?: ConstructorParameters<typeof LivePolice>[2]) { super(snap, rng, blocked, INSTANT_PURSUIT_TIMING); }
}

describe('WorldPolice', () => {
  it('ground units park beside the player (standoff), never on top of them', () => {
    const p = new WorldPolice(flatRoad, fixedRng);
    for (let i = 0; i < 200; i++) p.update(0.1, [{ id: 1, x: 0, z: 0, level: 2 }]);
    for (const u of p.unitsNear(0, 0, 1e6)) {
      const d = Math.hypot(u.x, u.z);
      expect(d).toBeGreaterThan(POLICE_STANDOFF_M - 1.7); // within one pursuit-speed tick of the standoff
      expect(d).toBeLessThanOrEqual(POLICE_STANDOFF_M + 0.01);
    }
  });

  it('the off-road fallback never drives through a building (blocked step ⇒ stays on the road)', () => {
    const ns: RoadSnap = (x, z) => (Math.abs(x + 107.5) < 40 ? { x: -107.5, y: 0, z, yaw: 0 } : null);
    const p = new WorldPolice(ns, () => 0.5, () => true); // every off-road step is blocked
    for (let i = 0; i < 30; i++) p.update(0.1, [{ id: 1, x: 0, z: 0, level: 1 }]);
    const u = [...p.unitsNear(0, 0, 1e6)][0]!;
    expect(u.x).toBeCloseTo(-107.5); // still on its road, not cut through the wall
  });

  it('a unit on a road perpendicular to the player still closes in (no stuck snap)', () => {
    // A single north-south road at x = -107.5 (where rng 0.5 spawns the unit): snapping projects any point straight
    // back onto that x, keeping z. The player is due east on the same z, so every straight step snaps back in place.
    const ns: RoadSnap = (x, z) => (Math.abs(x + 107.5) < 40 ? { x: -107.5, y: 0, z, yaw: 0 } : null);
    const p = new WorldPolice(ns, () => 0.5);
    p.update(0.1, [{ id: 1, x: 0, z: 0, level: 1 }]);
    const start = [...p.unitsNear(0, 0, 1e6)][0]!;
    const d0 = Math.hypot(start.x, start.z);
    for (let i = 0; i < 30; i++) p.update(0.1, [{ id: 1, x: 0, z: 0, level: 1 }]);
    const u = [...p.unitsNear(0, 0, 1e6)][0]!;
    expect(Math.hypot(u.x, u.z)).toBeLessThan(d0 - 20);
  });

  it('unitsNear lists every chasing unit within the radius (street-crime shot test)', () => {
    const p = new WorldPolice(flatRoad, fixedRng);
    p.update(0.1, [{ id: 1, x: 0, z: 0, level: 2 }]); // ~107.5 m from the player
    const all = [...p.unitsNear(0, 0, 120)];
    expect(all.length).toBe(p.count);
    expect(all.every(u => Number.isFinite(u.x) && Number.isFinite(u.y) && Number.isFinite(u.z))).toBe(true);
    expect([...p.unitsNear(0, 0, 50)]).toHaveLength(0);
  });

  it('spawns the desired number of units for the wanted level', () => {
    const p = new WorldPolice(flatRoad, fixedRng);
    p.update(0.1, [{ id: 1, x: 0, z: 0, level: 3 }]);
    expect(p.count).toBe(desiredUnits(3));
  });

  it('despawns down when the level drops and fully clears at 0 / when the target leaves', () => {
    const p = new WorldPolice(flatRoad, fixedRng);
    p.update(0.1, [{ id: 1, x: 0, z: 0, level: 4 }]);
    expect(p.count).toBe(desiredUnits(4));
    p.update(0.1, [{ id: 1, x: 0, z: 0, level: 1 }]);
    expect(p.count).toBe(desiredUnits(1));
    p.update(0.1, [{ id: 1, x: 0, z: 0, level: 0 }]); // no longer wanted
    expect(p.count).toBe(0);
  });

  it('closes in on the player and flips escapedLoS from true to false', () => {
    const p = new WorldPolice(flatRoad, fixedRng);
    p.update(0.1, [{ id: 1, x: 0, z: 0, level: 2 }]); // spawns ~107 m away
    expect(p.escapedFor(1, 0, 0)).toBe(true); // out of 70 m sight at spawn
    // Drive toward the player for a while (pursuit speed), player stationary at origin.
    for (let i = 0; i < 60; i++) p.update(0.1, [{ id: 1, x: 0, z: 0, level: 2 }]);
    expect(p.escapedFor(1, 0, 0)).toBe(false); // now within sight
  });

  it('lets the player escape when they outrun sight', () => {
    const p = new WorldPolice(flatRoad, fixedRng);
    p.update(0.1, [{ id: 1, x: 0, z: 0, level: 2 }]);
    for (let i = 0; i < 60; i++) p.update(0.1, [{ id: 1, x: 0, z: 0, level: 2 }]); // cars close in
    expect(p.escapedFor(1, 0, 0)).toBe(false);
    // Player is now 500 m away — cars are back near the origin, out of sight.
    expect(p.escapedFor(1, 500, 0)).toBe(true);
  });

  it('publishes police-flagged NPC-car entries near a viewer', () => {
    const p = new WorldPolice(flatRoad, fixedRng);
    p.update(0.1, [{ id: 1, x: 0, z: 0, level: 2 }]);
    const entries = p.entriesNear(0, 0, 20_000_000);
    expect(entries.length).toBe(desiredUnits(2));
    for (const e of entries) {
      expect(e.flags & 0x20).toBe(0x20);          // TRAFFIC_FLAG (NPC car)
      expect(e.flags & POLICE_FLAG).toBe(POLICE_FLAG); // police marker
      expect(e.kind).toBe('subaru');
      expect(e.id).toBeGreaterThanOrEqual(1_500_000);
    }
  });

  it('forget removes a target\'s units', () => {
    const p = new WorldPolice(flatRoad, fixedRng);
    p.update(0.1, [{ id: 1, x: 0, z: 0, level: 3 }, { id: 2, x: 1000, z: 0, level: 2 }]);
    expect(p.count).toBe(desiredUnits(3) + desiredUnits(2));
    p.forget(1);
    expect(p.count).toBe(desiredUnits(2));
  });

  it('caps total units world-wide across many wanted players (review fix 3)', () => {
    const p = new WorldPolice(flatRoad, fixedRng);
    // 30 players each want desiredUnits(5) chase cars (90+ desired), but the world cap holds the total at MAX_POLICE_UNITS.
    const many = Array.from({ length: 30 }, (_, i) => ({ id: i + 1, x: i * 500, z: 0, level: 5 }));
    p.update(0.1, many);
    expect(p.count).toBe(MAX_POLICE_UNITS);
    // Freeing players releases their units back under the cap.
    p.update(0.1, many.slice(0, 2));
    expect(p.count).toBeLessThanOrEqual(MAX_POLICE_UNITS);
  });

  it('forms a roadblock ahead once the player moves, at level 3+ only', () => {
    const p = new WorldPolice(flatRoad, fixedRng);
    // Level 2: never a roadblock, even while moving.
    p.update(0.1, [{ id: 1, x: 0, z: 0, level: 2 }]);
    p.update(0.1, [{ id: 1, x: 10, z: 0, level: 2 }]);
    expect(p.count).toBe(desiredUnits(2)); // chase cars only

    // Level 3: chase cars + a block ahead, but only after a heading is known (the player moved).
    const q = new WorldPolice(flatRoad, fixedRng);
    q.update(0.1, [{ id: 1, x: 0, z: 0, level: 3 }]);
    expect(q.count).toBe(desiredUnits(3)); // first tick, no heading yet → no block
    q.update(0.1, [{ id: 1, x: 10, z: 0, level: 3 }]); // moved +x → heading known
    expect(q.count).toBe(desiredUnits(3) + roadblockCount(3)); // chase + block
    const block = [...q.entriesNear(0, 0, 50_000_000)].filter(e => e.speedCmps === 0);
    expect(block.length).toBeGreaterThanOrEqual(2); // stationary block cars exist
  });

  it('re-forms the roadblock ahead after the player drives past it', () => {
    const p = new WorldPolice(flatRoad, fixedRng);
    p.update(0.1, [{ id: 1, x: 0, z: 0, level: 3 }]);
    p.update(0.1, [{ id: 1, x: 10, z: 0, level: 3 }]); // heading +x, block ~80 m ahead (at x≈80)
    const firstBlockXs = blockXs(p);
    expect(firstBlockXs.every(x => x > 10)).toBe(true); // block is ahead of the player
    // Drive well past the first block.
    p.update(0.1, [{ id: 1, x: 200, z: 0, level: 3 }]);
    const secondBlockXs = blockXs(p);
    expect(Math.min(...secondBlockXs)).toBeGreaterThan(Math.max(...firstBlockXs)); // new block is further ahead
  });

  it('drops the roadblock when the wanted level falls below 3', () => {
    const p = new WorldPolice(flatRoad, fixedRng);
    p.update(0.1, [{ id: 1, x: 0, z: 0, level: 3 }]);
    p.update(0.1, [{ id: 1, x: 10, z: 0, level: 3 }]);
    expect(p.count).toBe(desiredUnits(3) + roadblockCount(3));
    p.update(0.1, [{ id: 1, x: 20, z: 0, level: 2 }]); // dropped to 2
    expect(p.count).toBe(desiredUnits(2)); // chase only, block gone
  });
});

// Stationary roadblock cars have speedCmps 0; their world x (cm → m) identifies them for the re-form test.
function blockXs(p: WorldPolice): number[] {
  return p.entriesNear(0, 0, 50_000_000).filter(e => e.speedCmps === 0).map(e => e.x / 100);
}

describe('WorldPolice air + SWAT escalation (Combat 5b, flag policeAir)', () => {
  it('fields no helicopter/SWAT when air is off, even at wanted 5', () => {
    const p = new WorldPolice(flatRoad, fixedRng);
    p.update(0.1, [{ id: 1, x: 0, y: 0, z: 0, level: 5 }]); // air defaults off
    const e = p.entriesNear(0, 0, 50_000_000);
    expect(e.some(x => x.kind === 'supercar' || x.kind === 'bus')).toBe(false); // cruisers only
  });

  it('adds one helicopter (supercar stand-in, at altitude) at wanted 4 when air is on', () => {
    const p = new WorldPolice(flatRoad, fixedRng);
    p.update(0.1, [{ id: 1, x: 0, y: 0, z: 0, level: 4 }], { air: true });
    const helis = p.entriesNear(0, 0, 50_000_000).filter(x => x.kind === 'supercar');
    expect(helis.length).toBe(1);
    expect(helis[0]!.y).toBeGreaterThanOrEqual(HELICOPTER_ALTITUDE_M * 100 - 1); // hovers at ~altitude (cm)
  });

  it('adds SWAT vans (bus stand-in) at wanted 5 when air is on, alongside the helicopter', () => {
    const p = new WorldPolice(flatRoad, fixedRng);
    p.update(0.1, [{ id: 1, x: 0, y: 0, z: 0, level: 5 }], { air: true });
    const e = p.entriesNear(0, 0, 50_000_000);
    expect(e.filter(x => x.kind === 'bus').length).toBe(swatCount(5));
    expect(e.filter(x => x.kind === 'supercar').length).toBe(1);
  });

  it("the helicopter's wide spotlight keeps a player seen past a ground unit's range", () => {
    const p = new WorldPolice(flatRoad, fixedRng);
    for (let i = 0; i < 100; i++) p.update(0.1, [{ id: 1, x: 0, y: 0, z: 0, level: 4 }], { air: true }); // heli closes over the player
    expect(p.escapedFor(1, 0, 0)).toBe(false);   // overhead
    // Past a cruiser's sight but inside the spotlight (cruisers have parked within the standoff of the origin).
    expect(p.escapedFor(1, POLICE_SIGHT_M + 15, 0)).toBe(false);
    expect(p.escapedFor(1, HELICOPTER_SIGHT_M + 15, 0)).toBe(true);  // beyond the spotlight → escaped
  });
});

describe('SFPD officers on foot (sfpdOnFoot)', () => {
  // A north-south road at x = -40 (rng 0.5 spawns the car at x = -107.5, which snaps onto it, 40 m from the player);
  // the player stands in a "plaza" at the origin. Steps leaving the road eastward are blocked (a kerb/wall line at
  // x = -39.3), so the car stalls on its road, but an officer stepping out of it (spawned east of the line) can run.
  const ns: RoadSnap = (x, z) => (Math.abs(x + 40) < 80 ? { x: -40, y: 0, z, yaw: 0 } : null);
  const wall = (x0: number, _z0: number, x1: number) => x0 < -39.3 && x1 >= -39.3;
  const plaza = (foot: boolean, seconds: number, level = 2) => {
    const p = new WorldPolice(ns, () => 0.5, wall);
    for (let i = 0; i < seconds * 10; i++) p.update(0.1, [{ id: 1, x: 0, y: 0, z: 0, level, onFoot: true }], { foot });
    return p;
  };

  it('a stalled cruiser deploys officers who run to the player (and can bust: nearest ground unit within reach)', () => {
    const p = plaza(true, 40);
    const officers = [...p.officersNear(0, 0, 1e6)];
    expect(officers.length).toBe(2); // min(2, stars)
    for (const o of officers) expect(Math.hypot(o.x, o.z)).toBeLessThanOrEqual(OFFICER_STANDOFF_M + 0.01);
    expect(p.nearestGroundM(0, 0)).toBeLessThanOrEqual(OFFICER_STANDOFF_M + 0.01); // inside the 7 m bust radius
  });

  it('one officer per star, capped at two', () => {
    expect([...plaza(true, 10, 1).officersNear(0, 0, 1e6)]).toHaveLength(1);
    expect([...plaza(true, 10, 5).officersNear(0, 0, 1e6)]).toHaveLength(2);
  });

  it('no officers without the flag', () => {
    expect([...plaza(false, 40).officersNear(0, 0, 1e6)]).toHaveLength(0);
  });

  it('a cruiser that parks beside a player on foot lets its officers out; never for a player in a car', () => {
    const run = (onFoot: boolean) => {
      const p = new WorldPolice(flatRoad, fixedRng);
      for (let i = 0; i < 400; i++) p.update(0.1, [{ id: 1, x: 0, z: 0, level: 2, onFoot }], { foot: true });
      return [...p.officersNear(0, 0, 1e6)];
    };
    const out = run(true);
    expect(out).toHaveLength(2);
    for (const o of out) expect(Math.hypot(o.x, o.z)).toBeLessThanOrEqual(OFFICER_STANDOFF_M + 0.01);
    expect(run(false)).toHaveLength(0);
  });

  it('officers are not vehicles: never in the vehicle snapshot', () => {
    const p = plaza(true, 40);
    const cars = p.entriesNear(0, 0);
    expect(cars.length).toBe(p.count - 2); // everything but the two officers
  });

  it('officers are blocked by walls (hold rather than clip through)', () => {
    const p = new WorldPolice(ns, () => 0.5, () => true); // everything blocked: car stalls, officers can't move either
    for (let i = 0; i < 400; i++) p.update(0.1, [{ id: 1, x: 0, z: 0, level: 2, onFoot: true }], { foot: true });
    const held = [...p.officersNear(0, 0, 1e6)];
    expect(held).toHaveLength(2); // they did deploy…
    for (const o of held) expect(o.x).toBeLessThan(-37); // …but are still beside the car
  });

  it('on a hill officers stand on their OWN ground, not the player\'s height (review D-H1: no walking/shooting under houses)', () => {
    // The same road, but the street climbs 15% westward (uphill from the plaza): y = -0.15·x. The car stalls 40 m uphill
    // at y = 6. Each step's wall check gets the officer's height; record them and the officers' heights as they run down.
    const hill: RoadSnap = (x, z) => (Math.abs(x + 40) < 80 ? { x: -40, y: -0.15 * x, z, yaw: 0 } : null);
    const checkedAt: number[] = [];
    const p = new WorldPolice(hill, () => 0.5, (x0, z0, x1, z1, y) => { checkedAt.push(y); return wall(x0, z0, x1); });
    let maxOfficerY = -Infinity;
    for (let i = 0; i < 60; i++) { // 6 s: deployed and on the way, not yet beside the player
      p.update(0.1, [{ id: 1, x: 0, y: 0, z: 0, level: 2, onFoot: true }], { foot: true });
      for (const o of p.officersNear(0, 0, 1e6)) maxOfficerY = Math.max(maxOfficerY, o.y);
    }
    const running = [...p.officersNear(0, 0, 1e6)];
    expect(running.length).toBe(2);
    for (const o of running) {
      expect(Math.hypot(o.x, o.z)).toBeGreaterThan(OFFICER_ADOPT_PLAYER_Y_M); // still on the way…
      expect(o.y).toBeCloseTo(-0.15 * o.x, 5); // …at the hill's height beneath them (road snap), never the player's 0
    }
    expect(maxOfficerY).toBeGreaterThan(5); // the old code dropped them to the player's y = 0 on their first step
    expect(Math.max(...checkedAt)).toBeGreaterThan(5); // wall checks ran at the officers' own (uphill) height
  });
  it('officerGroundY: the player\'s y only when beside them, else the street beneath, else hold', () => {
    const road: RoadSnap = () => ({ x: 0, y: 12, z: 0, yaw: 0 });
    expect(officerGroundY(3, 1, 1, { x: 0, z: 0, y: 4 }, road)).toBe(4);   // beside the player
    expect(officerGroundY(3, 30, 0, { x: 0, z: 0, y: 4 }, road)).toBe(12); // far: the street under them
    expect(officerGroundY(3, 30, 0, { x: 0, z: 0, y: 4 }, () => null)).toBe(3); // no road nearby: hold
    expect(officerGroundY(3, 1, 0, { x: 0, z: 0 }, road)).toBe(12);        // player height unknown: the street
  });
  it('officers go when the wanted level clears', () => {
    const p = plaza(true, 40);
    p.update(0.1, [{ id: 1, x: 0, z: 0, level: 0 }], { foot: true });
    expect(p.count).toBe(0);
  });
});

describe('police ramming (policeRam)', () => {
  it('units ram a wanted DRIVER at 3★+ (gtasf-66lvh: was 2★), then back off for the cooldown', () => {
    const p = new WorldPolice(flatRoad, fixedRng);
    const target = { id: 1, x: 0, z: 0, level: 3, driving: true };
    let rams: ReturnType<typeof p.update> = [];
    let firstAt = -1;
    for (let i = 0; i < 200 && firstAt < 0; i++) { rams = p.update(0.1, [target], { ram: true }); if (rams.length) firstAt = i; }
    expect(firstAt).toBeGreaterThan(0);
    expect(rams[0]).toMatchObject({ targetId: 1 });
    const unit = rams[0]!.unitId;
    // Within the cooldown that unit can't ram again.
    let again = -1;
    for (let i = 1; i <= RAM_COOLDOWN_MS / 100 + 20; i++) if (p.update(0.1, [target], { ram: true }).some(r => r.unitId === unit)) { again = i; break; }
    expect(again).toBeGreaterThanOrEqual(RAM_COOLDOWN_MS / 100);
  });
  it('no rams on foot, below 3★, or with the flag off', () => {
    for (const [target, ram] of [[{ id: 1, x: 0, z: 0, level: 3, driving: false }, true], [{ id: 1, x: 0, z: 0, level: 2, driving: true }, true],
      [{ id: 1, x: 0, z: 0, level: 3, driving: true }, false]] as const) {
      const p = new WorldPolice(flatRoad, fixedRng);
      for (let i = 0; i < 200; i++) expect(p.update(0.1, [target], { ram })).toEqual([]);
    }
  });
});

describe('police sight + last-known position (gtasf-abijv)', () => {
  it('with line of sight, units keep the player in sight (no escape) and close in', () => {
    const p = new WorldPolice(flatRoad, fixedRng);
    const t = { id: 1, x: 0, z: 0, level: 2 };
    for (let i = 0; i < 200; i++) p.update(0.1, [t], { canSee: () => true });
    expect(p.escapedFor(1, 0, 0)).toBe(false);
    expect(p.nearestGroundM(0, 0)).toBeLessThan(10);
  });
  it('out of sight, units drive to where they LAST saw the player — moving away escapes', () => {
    const p = new WorldPolice(flatRoad, fixedRng);
    let visible = true;
    const canSee = () => visible;
    for (let i = 0; i < 200; i++) p.update(0.1, [{ id: 1, x: 0, z: 0, level: 2 }], { canSee });
    // Break line of sight and slip 150 m away: units head for (0,0), not the player.
    visible = false;
    for (let i = 0; i < 200; i++) p.update(0.1, [{ id: 1, x: 150, z: 0, level: 2 }], { canSee });
    expect(p.escapedFor(1, 150, 0)).toBe(true);
    expect(p.nearestGroundM(0, 0)).toBeLessThan(10);    // searching the last-seen spot
    expect(p.nearestGroundM(150, 0)).toBeGreaterThan(100); // not homing on the real player
  });
  it('dispatchTracksUntilSighted (critic N38): never seen yet, units home on the player who walked on, not the crime spot', () => {
    // The prod case: the crime at (0,0), the player walks off unseen; without tracking every unit parks at the crime spot.
    const run = (track: boolean) => {
      const p = new WorldPolice(flatRoad, fixedRng);
      let x = 0;
      for (let i = 0; i < 400; i++) { x = Math.min(150, x + 0.4); p.update(0.1, [{ id: 1, x, z: 0, level: 2 }], { canSee: () => false, trackUntilSighted: track }); }
      return p;
    };
    const tracked = run(true), legacy = run(false);
    expect(tracked.nearestGroundM(150, 0)).toBeLessThan(30);  // the units found where the player is now
    expect(legacy.nearestGroundM(0, 0)).toBeLessThan(10);     // flag off: parked at the crime spot (the old behaviour)
    expect(legacy.nearestGroundM(150, 0)).toBeGreaterThan(100);
  });
  it('dispatchTracksUntilSighted: once a unit HAS seen the player, breaking sight still sends them to the last-seen spot', () => {
    const p = new WorldPolice(flatRoad, fixedRng);
    let visible = true;
    const canSee = () => visible;
    for (let i = 0; i < 200; i++) p.update(0.1, [{ id: 1, x: 0, z: 0, level: 2 }], { canSee, trackUntilSighted: true });
    visible = false;
    for (let i = 0; i < 200; i++) p.update(0.1, [{ id: 1, x: 150, z: 0, level: 2 }], { canSee, trackUntilSighted: true });
    expect(p.escapedFor(1, 150, 0)).toBe(true);
    expect(p.nearestGroundM(0, 0)).toBeLessThan(10);       // searching where they last saw you: escape still works
    expect(p.nearestGroundM(150, 0)).toBeGreaterThan(100);
  });
  it('dispatchTracksUntilSighted: tracking stops at cover — a never-seen player who reaches a hideout is searched for at the edge, not homed on', () => {
    // Walk 150 m unseen into a garage whose cover starts at x = 120 (inCover), stand at x = 150: units go to the last
    // tracked spot (~120, the edge), and with the hideout's 12 m spot range don't find the player 30 m further in.
    const p = new WorldPolice(flatRoad, fixedRng);
    let x = 0;
    const inCover = (t: { x: number }) => t.x >= 120;
    for (let i = 0; i < 600; i++) { x = Math.min(150, x + 0.4); p.update(0.1, [{ id: 1, x, z: 0, level: 2 }], { canSee: () => false, trackUntilSighted: true, inCover }); }
    expect(p.nearestGroundM(150, 0)).toBeGreaterThan(SFPD_TUNING.hideoutSpotM); // not on top of the hidden player
    expect(p.nearestGroundM(120, 0)).toBeLessThan(30);                          // searching the edge of the garage
  });
  it('dispatchTracksUntilSighted: a cleared wanted level forgets the sighting (the next pursuit tracks again)', () => {
    const p = new WorldPolice(flatRoad, fixedRng);
    for (let i = 0; i < 100; i++) p.update(0.1, [{ id: 1, x: 0, z: 0, level: 2 }], { canSee: () => true, trackUntilSighted: true });
    p.update(0.1, [{ id: 1, x: 0, z: 0, level: 0 }], { canSee: () => false, trackUntilSighted: true }); // wanted cleared
    let x = 0;
    for (let i = 0; i < 400; i++) { x = Math.min(150, x + 0.4); p.update(0.1, [{ id: 1, x, z: 0, level: 2 }], { canSee: () => false, trackUntilSighted: true }); }
    expect(p.nearestGroundM(150, 0)).toBeLessThan(30);
  });
  it('the helicopter needs no line of sight (spotlight) within its range', () => {
    const p = new WorldPolice(flatRoad, fixedRng);
    for (let i = 0; i < 300; i++) p.update(0.1, [{ id: 1, x: 0, z: 0, level: 4 }], { air: true, canSee: () => false });
    expect(p.escapedFor(1, 0, 0)).toBe(false);
  });
});

describe('pursuit distance for a player on foot (founder playtest)', () => {
  it('cruisers hold back at the on-foot standoff instead of parking on the player; a driver gets the close standoff', () => {
    const foot = new WorldPolice(flatRoad, fixedRng);
    for (let i = 0; i < 300; i++) foot.update(0.1, [{ id: 1, x: 0, z: 0, level: 2, onFoot: true }]);
    expect(foot.nearestGroundM(0, 0)).toBeGreaterThanOrEqual(POLICE_FOOT_STANDOFF_M - 2); // within one tick's step
    expect(foot.nearestGroundM(0, 0)).toBeLessThan(POLICE_FOOT_STANDOFF_M + 2);
    const car = new WorldPolice(flatRoad, fixedRng);
    for (let i = 0; i < 300; i++) car.update(0.1, [{ id: 1, x: 0, z: 0, level: 2, onFoot: false }]);
    expect(car.nearestGroundM(0, 0)).toBeLessThan(POLICE_FOOT_STANDOFF_M - 2);
  });
});

describe('policeRam review: no rams on a hidden driver', () => {
  it('a unit parked at the LAST-SEEN spot never rams the real (hidden, far) car', () => {
    const p = new WorldPolice(flatRoad, fixedRng);
    let visible = true;
    const canSee = () => visible;
    // Seen at (0,0) on foot so units close in, then the player is in a car 150 m away and out of sight.
    for (let i = 0; i < 200; i++) p.update(0.1, [{ id: 1, x: 0, z: 0, level: 3, onFoot: true }], { canSee, ram: true });
    visible = false;
    for (let i = 0; i < 300; i++) expect(p.update(0.1, [{ id: 1, x: 150, z: 0, level: 3, driving: true }], { canSee, ram: true })).toEqual([]);
  });
});

describe('policeRam review: height (C-M1)', () => {
  it('a cruiser on the street never rams a driver on the freeway deck above it', () => {
    const p = new WorldPolice(flatRoad, fixedRng); // units ride the road at y = 0
    const onDeck = { id: 1, x: 0, y: 10, z: 0, level: 3, driving: true };
    for (let i = 0; i < 300; i++) expect(p.update(0.1, [onDeck], { ram: true })).toEqual([]);
  });
  it('a driver on the same street level is still rammed, and the ram carries the unit height', () => {
    const p = new WorldPolice(flatRoad, fixedRng);
    let rams: ReturnType<typeof p.update> = [];
    for (let i = 0; i < 200 && !rams.length; i++) rams = p.update(0.1, [{ id: 1, x: 0, y: 1, z: 0, level: 3, driving: true }], { ram: true });
    expect(rams[0]).toMatchObject({ targetId: 1, y: 0 });
  });
});

describe('review D-L3: officers step out on the clear side', () => {
  it('with a wall on the preferred side, the officer steps out on the other side', () => {
    // The car stalls at (−40, 0) facing the player at the origin; stepping to z > 0.5 is a wall. The second officer's
    // preferred side is z = +1 (blocked), so it must step out at z = −1 instead.
    const blocksNorth = (_x0: number, _z0: number, _x1: number, z1: number) => z1 > 0.5;
    const p = new WorldPolice((x, z) => (Math.abs(x + 40) < 80 ? { x: -40, y: 0, z: 0, yaw: 0 } : null), () => 0.5, blocksNorth);
    let officers: { z: number }[] = [];
    for (let i = 0; i < 400 && !officers.length; i++) { p.update(0.1, [{ id: 1, x: 0, z: 0, level: 2, onFoot: true }], { foot: true }); officers = [...p.officersNear(0, 0, 400)]; }
    expect(officers.length).toBeGreaterThan(0);
    for (const o of officers) expect(o.z).toBeLessThanOrEqual(0.5);
  });
});

describe('policePresence: officers fight from the cruiser door at 2★+ (critique #16)', () => {
  // flatRoad: the cruiser drives in and parks at the 10 m foot standoff; after the 2 s park its officers step out.
  const run = (level: number, cover: boolean, seconds = 40, target = { x: 0, z: 0 }) => {
    const p = new WorldPolice(flatRoad, fixedRng);
    for (let i = 0; i < seconds * 10; i++) p.update(0.1, [{ id: 1, ...target, level, onFoot: true }], { foot: true, cover });
    return p;
  };
  it('at 2★ they hold beside the parked car (~the 10 m standoff), facing the player, instead of charging to 1.5 m', () => {
    const officers = [...run(2, true).officersNear(0, 0, 1e6)];
    expect(officers).toHaveLength(2);
    for (const o of officers) {
      const d = Math.hypot(o.x, o.z);
      expect(d).toBeGreaterThan(POLICE_FOOT_STANDOFF_M - 1 - POLICE_CHASE_SPEED * 0.1 - 0.01); // parked within one tick, stepped 1 m out
      expect(d).toBeLessThanOrEqual(OFFICER_COVER_HOLD_M);
      expect(o.speedMps).toBe(0);
      const facing = Math.round(((Math.atan2(-o.x, -o.z) / (2 * Math.PI) + 1) * 256)) % 256;
      expect(o.yaw).toBe(facing);
    }
  });
  it('at 1★ they still close in for the arrest', () => {
    for (const o of run(1, true).officersNear(0, 0, 1e6)) expect(Math.hypot(o.x, o.z)).toBeLessThanOrEqual(OFFICER_STANDOFF_M + 0.01);
  });
  it('flag off: unchanged — they charge to hands-on distance', () => {
    for (const o of run(2, false).officersNear(0, 0, 1e6)) expect(Math.hypot(o.x, o.z)).toBeLessThanOrEqual(OFFICER_STANDOFF_M + 0.01);
  });
  it('they leave cover and give chase once the player is out of range, and do not return to the door', () => {
    const p = new WorldPolice(flatRoad, fixedRng);
    const tick = (x: number, n: number) => { for (let i = 0; i < n; i++) p.update(0.1, [{ id: 1, x, z: 0, level: 2, onFoot: true }], { foot: true, cover: true }); };
    tick(0, 400); // deployed + holding
    const before = [...p.officersNear(0, 0, 1e6)].map(o => ({ ...o }));
    expect(before).toHaveLength(2);
    tick(60, 1); // the player is suddenly 60 m east (> the 30 m hold range)
    tick(60, 100);
    const after = [...p.officersNear(60, 0, 1e6)];
    expect(after).toHaveLength(2);
    for (const o of after) expect(Math.hypot(o.x - 60, o.z)).toBeLessThan(Math.min(...before.map(b => Math.hypot(b.x - 60, b.z)))); // closed in
  });
});

describe('gtasf-66lvh: SFPD reaction + escalation timing (fair police)', () => {
  const tick = (p: LivePolice, seconds: number, t: { id: number; x: number; z: number; level: number }, opts: Parameters<LivePolice['update']>[2] = {}) => {
    for (let i = 0; i < Math.round(seconds * 10); i++) p.update(0.1, [t], opts);
  };
  it('the first cruiser is dispatched after the delay, then reinforcements one per interval', () => {
    const p = new LivePolice(flatRoad, fixedRng); // default (real) timing
    const t = { id: 1, x: 0, z: 0, level: 4 };
    tick(p, DEFAULT_PURSUIT_TIMING.dispatchDelayMs / 1000 - 0.3, t);
    expect(p.count).toBe(0); // nobody there yet
    tick(p, 0.5, t);
    expect(p.count).toBe(1); // first unit
    tick(p, DEFAULT_PURSUIT_TIMING.dispatchIntervalMs / 1000 - 0.5, t);
    expect(p.count).toBe(1); // reinforcement not yet
    tick(p, 0.6, t);
    expect(p.count).toBe(2);
    tick(p, 30, t);
    expect(p.count).toBe(desiredUnits(4)); // fills up to the per-star count, no more
  });
  it('the helicopter only arrives after the escalation delay at 4★', () => {
    const p = new LivePolice(flatRoad, fixedRng, undefined, { ...INSTANT_PURSUIT_TIMING, helicopterDelayMs: DEFAULT_PURSUIT_TIMING.helicopterDelayMs });
    const t = { id: 1, x: 0, z: 0, level: 4 };
    tick(p, DEFAULT_PURSUIT_TIMING.helicopterDelayMs / 1000 - 1, t, { air: true });
    expect(p.entriesNear(0, 0, 1e9).some(e => e.kind === 'supercar')).toBe(false);
    tick(p, 1.5, t, { air: true });
    expect(p.entriesNear(0, 0, 1e9).some(e => e.kind === 'supercar')).toBe(true);
  });
  it('roadblocks wait for the delay at 3★ and are never planted ahead of a player the units cannot see', () => {
    const run = (visible: boolean) => {
      const p = new LivePolice(flatRoad, fixedRng, undefined, { ...INSTANT_PURSUIT_TIMING, roadblockDelayMs: DEFAULT_PURSUIT_TIMING.roadblockDelayMs });
      let x = 0;
      const step = (seconds: number) => { for (let i = 0; i < seconds * 10; i++) { x += 0.4; p.update(0.1, [{ id: 1, x, z: 0, level: 3 }], { canSee: () => visible }); } };
      step(DEFAULT_PURSUIT_TIMING.roadblockDelayMs / 1000 - 1);
      const before = p.count;
      step(2);
      return { before, after: p.count };
    };
    const seen = run(true);
    expect(seen.before).toBe(desiredUnits(3));
    expect(seen.after).toBe(desiredUnits(3) + roadblockCount(3));
    expect(run(false).after).toBe(desiredUnits(3)); // hidden: no block reads your position off the map
  });
  it('hideout cover: ground units only spot you up close and the helicopter not at all', () => {
    const p = new LivePolice(flatRoad, fixedRng, undefined, INSTANT_PURSUIT_TIMING);
    const t = { id: 1, x: 0, z: 0, level: 4 };
    // A unit at ~30 m with a clear line would see you; in cover it can't.
    for (let i = 0; i < 60; i++) p.update(0.1, [t], { air: true, canSee: () => true, inCover: () => true });
    expect(p.nearestGroundM(0, 0)).toBeGreaterThan(12); // cruisers ~30 m out after 6 s (the heli is overhead)
    expect(p.escapedFor(1, 0, 0)).toBe(true);
    const q = new LivePolice(flatRoad, fixedRng, undefined, INSTANT_PURSUIT_TIMING);
    for (let i = 0; i < 100; i++) q.update(0.1, [{ id: 1, x: 0, z: 0, level: 4 }], { air: true, canSee: () => false, inCover: () => true });
    expect(q.escapedFor(1, 0, 0)).toBe(true); // the heli overhead can't see under the roof
  });
});

describe('sfpdCover: officers under fire break for the far side of a stopped cruiser (gtasf-ex3nf)', () => {
  // flatRoad: the cruiser parks at the 10 m foot standoff and its officers step out WITHOUT door cover (cover option off), so
  // they charge; once the player starts shooting they should run behind the parked car instead.
  const tick = (p: WorldPolice, n: number, firing: boolean, opts: { takeCover?: boolean; level?: number } = {}) => {
    for (let i = 0; i < n; i++) p.update(0.1, [{ id: 1, x: 0, z: 0, level: opts.level ?? 2, onFoot: true, firing }], { foot: true, takeCover: opts.takeCover ?? true });
  };
  const cruisers = (p: WorldPolice) => [...p.unitsNear(0, 0, 1e6)].filter(u => (u as { role?: string }).role === 'chase');
  it('a firing player at 2★: officers run to the cruiser side away from the player and hold there, facing the player', () => {
    const p = new WorldPolice(flatRoad, fixedRng);
    tick(p, 400, false); // deployed and charging in the open (no door cover)
    const charging = [...p.officersNear(0, 0, 1e6)];
    expect(charging).toHaveLength(2);
    for (const o of charging) expect(Math.hypot(o.x, o.z)).toBeLessThanOrEqual(OFFICER_STANDOFF_M + 0.01);
    tick(p, 200, true); // the player opens fire
    const parked = cruisers(p).filter(c => (c as unknown as { speedMps: number }).speedMps < .5);
    expect(parked.length).toBeGreaterThan(0);
    for (const o of p.officersNear(0, 0, 1e6)) {
      const car = parked.reduce((a, b) => Math.hypot(a.x - o.x, a.z - o.z) <= Math.hypot(b.x - o.x, b.z - o.z) ? a : b);
      expect(Math.hypot(o.x - car.x, o.z - car.z)).toBeLessThanOrEqual(OFFICER_COVER_OFFSET_M + 0.35); // at the cover spot
      expect(Math.hypot(o.x, o.z)).toBeGreaterThan(Math.hypot(car.x, car.z)); // the car is between them and the player
      expect(o.speedMps).toBe(0);
      expect(o.yaw).toBe(Math.round(((Math.atan2(-o.x, -o.z) / (2 * Math.PI) + 1) * 256)) % 256); // facing the player
    }
  });
  it('no shooting: unchanged — they keep charging to hands-on distance', () => {
    const p = new WorldPolice(flatRoad, fixedRng); tick(p, 600, false);
    for (const o of p.officersNear(0, 0, 1e6)) expect(Math.hypot(o.x, o.z)).toBeLessThanOrEqual(OFFICER_STANDOFF_M + 0.01);
  });
  it('flag off: unchanged even while the player shoots', () => {
    const p = new WorldPolice(flatRoad, fixedRng); tick(p, 400, false, { takeCover: false }); tick(p, 200, true, { takeCover: false });
    for (const o of p.officersNear(0, 0, 1e6)) expect(Math.hypot(o.x, o.z)).toBeLessThanOrEqual(OFFICER_STANDOFF_M + 0.01);
  });
  it('at 1★ (no police fire) they still close in for the arrest', () => {
    const p = new WorldPolice(flatRoad, fixedRng); tick(p, 400, false, { level: 1 }); tick(p, 200, true, { level: 1 });
    for (const o of p.officersNear(0, 0, 1e6)) expect(Math.hypot(o.x, o.z)).toBeLessThanOrEqual(OFFICER_STANDOFF_M + 0.01);
  });
});
