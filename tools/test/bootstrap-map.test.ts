import { expect, it } from 'vitest';
import { geodeticToWorld, worldToGeodetic } from '../map/src/geo';
import { SF_FRAME } from '../map/src/config';
it('uses SF ENU, preserves east/north sign and round-trips city corners', () => {
  const origin = geodeticToWorld(SF_FRAME.origin.lat, SF_FRAME.origin.lon, SF_FRAME); expect(origin[0]).toBeCloseTo(0, 6); expect(origin[1]).toBeCloseTo(0, 6);
  for (const [lat, lon] of [[37.8021,-122.4197],[37.76,-122.45],[37.71,-122.51]]) {
    const [x,z] = geodeticToWorld(lat!,lon!,SF_FRAME), point=worldToGeodetic(x,z,SF_FRAME); expect(point.lat).toBeCloseTo(lat!,7);expect(point.lon).toBeCloseTo(lon!,7);
  }
  // A point NE of the origin (lon -122.40 is east of origin -122.4078; lat 37.81 is north): east > 0, z < 0.
  expect(geodeticToWorld(37.81,-122.40,SF_FRAME)[0]).toBeGreaterThan(0); expect(geodeticToWorld(37.81,-122.40,SF_FRAME)[1]).toBeLessThan(0);
});
