import { describe, expect, it } from 'vitest';
import { PITCH_VCS } from '../content/pitchVcs';
import {
  FOUNDER_PITCH_LINES, FOUNDER_PLAZA_VC_ID, FOUNDER_PLAZA_VC_NAME, FOUNDER_PLAZA_ANGEL, FOUNDER_OPENER_ANGEL,
  founderPitchLine, founderPlazaAngel, isFounderPitchLine,
} from './pitch';

describe('founder-ladder first-pitch content', () => {
  it('the plaza investor is a REAL VC firm present in pitchVcs (so a takedown removes it everywhere)', () => {
    const firm = PITCH_VCS.find(v => v.id === FOUNDER_PLAZA_VC_ID);
    expect(firm).toBeDefined();
    expect(firm!.name).toBe(FOUNDER_PLAZA_VC_NAME);
  });

  it('places the plaza NPC near the Ferry spawn (~37.7955, -122.3937)', () => {
    expect(Math.abs(FOUNDER_PLAZA_ANGEL.lat - 37.7955)).toBeLessThan(0.002);
    expect(Math.abs(FOUNDER_PLAZA_ANGEL.lon - -122.3937)).toBeLessThan(0.002);
  });

  it('guidedOpener moves the partner a 300-500 m drive down the Embarcadero; off keeps the plaza', () => {
    expect(founderPlazaAngel(false)).toBe(FOUNDER_PLAZA_ANGEL);
    expect(founderPlazaAngel(true)).toBe(FOUNDER_OPENER_ANGEL);
    const m = Math.hypot((FOUNDER_OPENER_ANGEL.lat - FOUNDER_PLAZA_ANGEL.lat) * 111_320,
      (FOUNDER_OPENER_ANGEL.lon - FOUNDER_PLAZA_ANGEL.lon) * 111_320 * Math.cos(37.79 * Math.PI / 180));
    expect(m).toBeGreaterThan(300); expect(m).toBeLessThan(500);
  });

  it('offers exactly three curated tap-fallback pitch lines', () => {
    expect(FOUNDER_PITCH_LINES).toHaveLength(3);
    for (const line of FOUNDER_PITCH_LINES) expect(line.length).toBeGreaterThan(20);
  });

  it('validates a line index and resolves it to the curated text (server never trusts free text)', () => {
    expect(isFounderPitchLine(0)).toBe(true);
    expect(isFounderPitchLine(2)).toBe(true);
    expect(isFounderPitchLine(3)).toBe(false);
    expect(isFounderPitchLine(-1)).toBe(false);
    expect(isFounderPitchLine(1.5)).toBe(false);
    expect(isFounderPitchLine('0')).toBe(false);
    expect(isFounderPitchLine(null)).toBe(false);
    expect(founderPitchLine(1)).toBe(FOUNDER_PITCH_LINES[1]);
    expect(founderPitchLine(9)).toBeNull();
    expect(founderPitchLine('x')).toBeNull();
  });
});
