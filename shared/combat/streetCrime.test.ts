import { describe, expect, it } from 'vitest';
import {
  applyStreetCrime, COP_HIT_INTERVAL_MS, freshStreetCrimeClock, GUNFIRE_CRIME_INTERVAL_MS, GUNFIRE_HEAT_CAP,
  crimeForReport, pedCrimeForReport, PED_KILL_INTERVAL_MS, segmentPointDistance, shotHitsPolice, streetCrimeForShot,
} from './streetCrime';
import { CRIME_HEAT, freshWanted, wantedLevel } from './wanted';

const gun = { melee: false, hitPlayer: false, hitPolice: false };

describe('streetCrimeForShot', () => {
  it('public gunfire is a mayhem crime, rate-limited per shooter', () => {
    const clock = freshStreetCrimeClock();
    expect(streetCrimeForShot(gun, clock, 0, 1000)).toBe('mayhem');
    expect(streetCrimeForShot(gun, clock, 5, 1000 + GUNFIRE_CRIME_INTERVAL_MS - 1)).toBeNull();
    expect(streetCrimeForShot(gun, clock, 5, 1000 + GUNFIRE_CRIME_INTERVAL_MS)).toBe('mayhem');
  });

  it('a melee swing at nothing is not gunfire', () => {
    expect(streetCrimeForShot({ ...gun, melee: true }, freshStreetCrimeClock(), 0, 0)).toBeNull();
  });

  it('a shot that hits a player raises nothing extra (its assault/kill path already did)', () => {
    expect(streetCrimeForShot({ ...gun, hitPlayer: true, hitPolice: true }, freshStreetCrimeClock(), 0, 0)).toBeNull();
  });

  it('shooting the police is a cop-hit (melee too), rate-limited, and counts as the gunfire for that window', () => {
    const clock = freshStreetCrimeClock();
    expect(streetCrimeForShot({ ...gun, melee: true, hitPolice: true }, clock, 0, 0)).toBe('cop-hit');
    expect(streetCrimeForShot({ ...gun, hitPolice: true }, clock, 24, COP_HIT_INTERVAL_MS - 1)).toBeNull();
    expect(streetCrimeForShot(gun, clock, 24, COP_HIT_INTERVAL_MS - 1)).toBeNull(); // gunfire window consumed
    expect(streetCrimeForShot({ ...gun, hitPolice: true }, clock, 24, COP_HIT_INTERVAL_MS)).toBe('cop-hit');
  });

  it('cop hits are not capped by the gunfire cap', () => {
    expect(streetCrimeForShot({ ...gun, hitPolice: true }, freshStreetCrimeClock(), 99, 0)).toBe('cop-hit');
  });

  it('gunfire stops adding once heat reaches the 3-star threshold', () => {
    expect(streetCrimeForShot(gun, freshStreetCrimeClock(), GUNFIRE_HEAT_CAP, 0)).toBeNull();
  });
});

describe('pedCrimeForReport', () => {
  it('a confessed ped kill is a ped-kill crime, rate-limited per player', () => {
    const clock = freshStreetCrimeClock();
    expect(pedCrimeForReport(clock, 0)).toBe('ped-kill');
    expect(pedCrimeForReport(clock, PED_KILL_INTERVAL_MS - 1)).toBeNull();
    expect(pedCrimeForReport(clock, PED_KILL_INTERVAL_MS)).toBe('ped-kill');
  });

  it('ped kills and gunfire have independent windows (shoot a ped: gunfire + kill both count)', () => {
    const clock = freshStreetCrimeClock();
    expect(streetCrimeForShot(gun, clock, 0, 0)).toBe('mayhem');
    expect(pedCrimeForReport(clock, 10)).toBe('ped-kill');
  });

  it('three ped kills reach 3 stars', () => {
    const clock = freshStreetCrimeClock();
    let state = freshWanted();
    for (const t of [0, 1000, 2000]) { const c = pedCrimeForReport(clock, t); if (c) state = applyStreetCrime(state, c, t); }
    expect(wantedLevel(state.heat)).toBe(3);
  });
});

describe('applyStreetCrime', () => {
  it('sustained gunfire escalates to 2 stars and never to 3', () => {
    const clock = freshStreetCrimeClock();
    let state = freshWanted();
    for (let t = 0; t < 120_000; t += 100) {
      const crime = streetCrimeForShot(gun, clock, state.heat, t);
      if (crime) state = applyStreetCrime(state, crime, t);
    }
    expect(wantedLevel(state.heat)).toBe(2);
    expect(state.heat).toBe(GUNFIRE_HEAT_CAP - 1);
  });

  it('the first shot fired gives 1 star', () => {
    expect(wantedLevel(applyStreetCrime(freshWanted(), 'mayhem', 0).heat)).toBe(1);
  });

  it('gunfire does not lower heat that is already above the cap', () => {
    expect(applyStreetCrime({ heat: 60, lastCrimeMs: 0 }, 'mayhem', 5).heat).toBe(60);
  });

  it('cop hits add full heat past the gunfire cap', () => {
    expect(applyStreetCrime({ heat: 40, lastCrimeMs: 0 }, 'cop-hit', 1).heat).toBe(40 + CRIME_HEAT['cop-hit']);
  });
});

describe('shotHitsPolice', () => {
  it('measures distance to a segment, clamped at the ends', () => {
    expect(segmentPointDistance([0, 0, 0], [10, 0, 0], [5, 3, 0])).toBeCloseTo(3);
    expect(segmentPointDistance([0, 0, 0], [10, 0, 0], [13, 4, 0])).toBeCloseTo(5);
    expect(segmentPointDistance([1, 1, 1], [1, 1, 1], [1, 1, 4])).toBeCloseTo(3);
  });

  it('a shot through a cruiser hits; one passing wide or stopping short misses', () => {
    const cruiser = [{ x: 20, y: 0, z: 0 }];
    expect(shotHitsPolice([0, 1.4, 0], [40, 1.4, 0], cruiser)).toBe(true);
    expect(shotHitsPolice([0, 1.4, 0], [40, 1.4, 6], cruiser)).toBe(false);
    expect(shotHitsPolice([0, 1.4, 0], [10, 1.4, 0], cruiser)).toBe(false); // blocked/short of the car
    expect(shotHitsPolice([0, 1.4, 0], [40, 1.4, 0], [])).toBe(false);
  });

  it('a unit behind a building (no line of sight) is not hit', () => {
    const cruiser = [{ x: 20, y: 0, z: 0 }];
    expect(shotHitsPolice([0, 1.4, 0], [40, 1.4, 0], cruiser, () => false)).toBe(false);
    expect(shotHitsPolice([0, 1.4, 0], [40, 1.4, 0], cruiser, body => body[1] === 1)).toBe(true);
  });
});

describe('crimeForReport', () => {
  it('ramming a police car is a cop-hit, rate-limited with shot cop-hits', () => {
    const clock = freshStreetCrimeClock();
    expect(crimeForReport(2, clock, 0)).toBe('cop-hit');
    expect(crimeForReport(2, clock, COP_HIT_INTERVAL_MS - 1)).toBeNull();
    expect(streetCrimeForShot({ ...gun, hitPolice: true }, clock, 30, COP_HIT_INTERVAL_MS - 1)).toBeNull(); // shared window
    expect(crimeForReport(2, clock, COP_HIT_INTERVAL_MS)).toBe('cop-hit');
  });
  it('ped confessions still map to ped-kill', () => {
    const clock = freshStreetCrimeClock();
    expect(crimeForReport(0, clock, 0)).toBe('ped-kill');
    expect(crimeForReport(1, clock, PED_KILL_INTERVAL_MS)).toBe('ped-kill');
  });
  it('a knockout (kind 3, pedMelee) is a rate-limited assault', () => {
    const clock = freshStreetCrimeClock();
    expect(crimeForReport(3, clock, 0)).toBe('assault');
    expect(crimeForReport(3, clock, PED_KILL_INTERVAL_MS - 1)).toBeNull();
    expect(crimeForReport(3, clock, PED_KILL_INTERVAL_MS)).toBe('assault');
  });
});
