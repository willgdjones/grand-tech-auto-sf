import { describe, expect, it } from 'vitest';
import { SF_GENERAL_RESPAWN } from './economy';
import { HELD_HOSPITALS, nearestHospital, RESPAWN_HOSPITALS } from './respawn';

// Local equirectangular projection around SF (+x east, -z north): close enough to rank hospitals kilometres apart.
const project = (lat: number, lon: number) => ({ x: (lon + 122.42) * 88_000, z: -(lat - 37.78) * 111_000 });
const at = (lat: number, lon: number) => project(lat, lon);

describe('nearestHospital (critic N20)', () => {
  it('keeps SF General as the first entry, on the shared respawn constant', () => {
    expect(RESPAWN_HOSPITALS[0]).toMatchObject({ id: 'sf-general', lat: SF_GENERAL_RESPAWN.lat, lon: SF_GENERAL_RESPAWN.lon });
  });
  it('sends a death at the Ferry Building start to a downtown hospital, not SF General 4.7 km away', () => {
    const pick = nearestHospital(at(37.7955, -122.3937), project);
    expect(pick.id).not.toBe('sf-general');
    const p = project(pick.lat, pick.lon), ferry = at(37.7955, -122.3937);
    expect(Math.hypot(p.x - ferry.x, p.z - ferry.z)).toBeLessThan(3_300);
  });
  it('picks the hospital of each district', () => {
    expect(nearestHospital(at(37.7599, -122.4148), project).id).toBe('sf-general');      // Mission & 20th
    expect(nearestHospital(at(37.7880, -122.4075), project).id).toBe('saint-francis');   // Union Square
    expect(nearestHospital(at(37.7786, -122.3893), project).id).toBe('ucsf-mission-bay'); // Oracle Park
    expect(nearestHospital(at(37.7692, -122.4481), project).id).toBe('st-marys');         // Haight & Ashbury
  });
  it('St. Mary\'s respawns at the moved Stanyan spot (gtasf-2mdpz), not the buried one; nothing is held', () => {
    const stMarys = RESPAWN_HOSPITALS.find(h => h.id === 'st-marys')!;
    expect(stMarys).toMatchObject({ lat: 37.774227, lon: -122.454550, heading: 125 });
    expect(HELD_HOSPITALS).toHaveLength(0);
  });
  it('returns the only hospital when given one, and keeps list order on a tie', () => {
    const one = [RESPAWN_HOSPITALS[2]!];
    expect(nearestHospital(at(37.80, -122.47), project, one).id).toBe('ucsf-mission-bay');
    const twins = [{ ...RESPAWN_HOSPITALS[0]!, id: 'a' }, { ...RESPAWN_HOSPITALS[0]!, id: 'b' }];
    expect(nearestHospital(at(37.75, -122.40), project, twins).id).toBe('a');
  });
});
