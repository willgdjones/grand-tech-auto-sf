import { geodeticToWorld } from '../geo';
import { SF_FRAME } from '../config';
import { DISTRICTS_CORE } from './core';
import { DISTRICTS_WEST } from './west';
import { DISTRICTS_SOUTH } from './south';
import { DISTRICTS_NORTHWEST } from './northwest';
import type { DistrictProfile } from './types';

export type { DistrictProfile, Colour, BuildingUse, FacadeStyle } from './types';
export const DISTRICTS: readonly DistrictProfile[] = [...DISTRICTS_CORE,...DISTRICTS_WEST,...DISTRICTS_SOUTH,...DISTRICTS_NORTHWEST]
  .sort((a,b) => b.priority-a.priority || a.id.localeCompare(b.id));
/** Resolve once: map geometry and browser consumers use the same metre-space regions. */
export const DISTRICT_REGIONS = DISTRICTS.map(profile => {
  const [w,s,e,n] = profile.bbox;
  const [x0,z0] = geodeticToWorld(n,w,SF_FRAME), [x1,z1] = geodeticToWorld(s,e,SF_FRAME);
  return { profile, bounds: [x0,z0,x1,z1] as const };
});
export function districtAt(x: number, z: number): DistrictProfile | undefined {
  return DISTRICT_REGIONS.find(({bounds:[x0,z0,x1,z1]}) => x>=x0 && x<=x1 && z>=z0 && z<=z1)?.profile;
}
