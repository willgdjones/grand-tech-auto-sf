import { describe, expect, it } from 'vitest';
import {
  addHeat, CRIME_HEAT, freshWanted, pursuitCars, tickWanted, WANTED_COOLDOWN_MS,
  wantedLevel, wantedRaiseAllowed, wantedResponse,
} from './wanted';

describe('wantedLevel', () => {
  it('maps heat to 0–5 stars by threshold', () => {
    expect(wantedLevel(0)).toBe(0);
    expect(wantedLevel(1)).toBe(1);
    expect(wantedLevel(21)).toBe(1);
    expect(wantedLevel(22)).toBe(2);
    expect(wantedLevel(65)).toBe(4);
    expect(wantedLevel(100)).toBe(5);
  });
});

describe('addHeat', () => {
  it('accumulates crime heat and stamps the time', () => {
    let s = freshWanted();
    s = addHeat(s, 'assault', 1000);
    expect(s.heat).toBe(CRIME_HEAT.assault);
    expect(s.lastCrimeMs).toBe(1000);
    s = addHeat(s, 'ped-kill', 2000);
    expect(s.heat).toBe(CRIME_HEAT.assault + CRIME_HEAT['ped-kill']);
    expect(s.lastCrimeMs).toBe(2000);
  });

  it('a store robbery lands at 2 stars (founder: instant 2 stars)', () => {
    const s = addHeat(freshWanted(), 'store-robbery', 0);
    expect(wantedLevel(s.heat)).toBe(2);
  });

  it('a carjack (car-theft) lands at 1 star', () => {
    const s = addHeat(freshWanted(), 'car-theft', 0);
    expect(s.heat).toBe(CRIME_HEAT['car-theft']);
    expect(wantedLevel(s.heat)).toBe(1);
  });

  it('a heist grab lands at 3 stars (lane C pitch-deck heist escape)', () => {
    const s = addHeat(freshWanted(), 'heist', 0);
    expect(wantedLevel(s.heat)).toBe(3);
  });

  it('cop kills escalate fast and heat clamps at 100 (5 stars)', () => {
    let s = freshWanted();
    for (let i = 0; i < 5; i++) s = addHeat(s, 'cop-kill', i * 100);
    expect(s.heat).toBe(100);
    expect(wantedLevel(s.heat)).toBe(5);
  });
});

describe('tickWanted (decay)', () => {
  it('holds heat while the player is still seen by police', () => {
    const s = addHeat(freshWanted(), 'cop-kill', 0); // 42 heat → 3 stars
    const after = tickWanted(s, 5, false /* in sight */, 0 + WANTED_COOLDOWN_MS + 5000);
    expect(after.heat).toBe(s.heat);
  });

  it('holds heat during the cooldown even after escaping', () => {
    const s = addHeat(freshWanted(), 'cop-kill', 0);
    const after = tickWanted(s, 5, true /* escaped */, WANTED_COOLDOWN_MS - 1);
    expect(after.heat).toBe(s.heat);
  });

  it('bleeds heat once escaped and past the cooldown', () => {
    const s = addHeat(freshWanted(), 'cop-kill', 0); // 42
    const after = tickWanted(s, 2, true, WANTED_COOLDOWN_MS + 1, { decayPerSec: 4 });
    expect(after.heat).toBe(42 - 8);
    expect(wantedLevel(after.heat)).toBe(2); // dropped from 3 → 2 stars
  });

  it('clears to 0 and never goes negative', () => {
    let s = addHeat(freshWanted(), 'assault', 0); // 8
    s = tickWanted(s, 100, true, WANTED_COOLDOWN_MS + 1);
    expect(s.heat).toBe(0);
    expect(wantedLevel(s.heat)).toBe(0);
  });
});

describe('wantedResponse / pursuitCars escalation', () => {
  it('escalates cars → roadblocks → helicopter → SWAT by level', () => {
    expect(wantedResponse(0)).toBe('none');
    expect(wantedResponse(1)).toBe('patrol');
    expect(wantedResponse(2)).toBe('pursuit');
    expect(wantedResponse(3)).toBe('roadblock');
    expect(wantedResponse(4)).toBe('helicopter');
    expect(wantedResponse(5)).toBe('swat');
  });

  it('pursuit car count grows with the level and clamps', () => {
    expect(pursuitCars(0)).toBe(0);
    expect(pursuitCars(2)).toBe(1); // gtasf-66lvh: fewer units per star
    expect(pursuitCars(3)).toBe(2);
    expect(pursuitCars(5)).toBe(3);
    expect(pursuitCars(9)).toBe(3);
  });
});

describe('wantedRaiseAllowed (review fix 5)', () => {
  it('requires both combat and wanted (the hook/crime raise can never fire without the system live)', () => {
    expect(wantedRaiseAllowed({ combat: true, wanted: true })).toBe(true);
    expect(wantedRaiseAllowed({ combat: true, wanted: false })).toBe(false);
    expect(wantedRaiseAllowed({ combat: false, wanted: true })).toBe(false); // the fix: combat now required too
    expect(wantedRaiseAllowed({ combat: false, wanted: false })).toBe(false);
  });
});
