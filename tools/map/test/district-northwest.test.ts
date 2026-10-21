import { expect, it } from 'vitest';
import { districtAt } from '../src/districts';
import { DISTRICTS_NORTHWEST } from '../src/districts/northwest';
import { project } from '../src/pipeline/settings';

it('keeps northwest arrivals in their own art regions and painted houses out of glass/shopfront type bands', () => {
  // Both subregions overlap larger profiles: registry priority must preserve
  // Japantown's stone/concrete and the Golden Gate arrival landscape.
  expect(districtAt(...project(-122.4294, 37.7854))?.id).toBe('japantown');
  expect(districtAt(...project(-122.4740, 37.8065))?.id).toBe('golden-gate-approach');
  for (const district of DISTRICTS_NORTHWEST) {
    expect(districtAt(...project(district.spawn.lon, district.spawn.lat))?.id, district.id).toBe(district.id);
    expect(district.ground.park[1]).toBeGreaterThan(district.ground.park[0]);
    expect(district.ground.urban[2]).toBeGreaterThan(.35);
    for (const [use, colours] of Object.entries(district.buildings)) {
      for (const colour of colours!) for (const shade of [.88, 1, 1.12]) {
        // GLB COLOR_0 is normalized u8. Check its actual wire precision, including
        // the legacy bake's brightness endpoints, against the renderer contract.
        const [r, g, b] = colour.map(c => Math.round(Math.min(1, c * shade) * 255) / 255) as [number, number, number];
        const office = b > r * 1.03;
        const industrial = Math.abs(r - g) < .012 && g > b * 1.025;
        const retail = r > g * 1.10 && r < g * 1.17 && g > b * 1.18;
        const context = `${district.id}/${use}/${colour.join(',')}/${shade}`;
        if (use === 'residential') expect(office || industrial || retail, context).toBe(false);
        if (use === 'commercial') expect(office, context).toBe(true);
        if (use === 'retail') expect(retail && !office && !industrial, context).toBe(true);
        if (use === 'industrial') expect(industrial && !office && !retail, context).toBe(true);
      }
    }
  }
});
