import type { DistrictProfile } from './types';

/** Authored art regions, not administrative boundaries. Coordinates use WGS84;
 * colours are linear RGB. Heights, footprints and street geometry stay sourced.
 * Small houses survive only within buildingRadius of the selected source streets.
 * Palettes keep the legacy facade classifier's type bands until an explicit style
 * attribute is supported by both the bake and renderer. In particular, sage and
 * lavender residential paint must not accidentally classify as office glass.
 */
export const DISTRICTS_NORTHWEST: readonly DistrictProfile[] = [
  {
    id: 'marina', name: 'Marina',
    bbox: [-122.4486, 37.799, -122.4238, 37.8092], priority: 30,
    ground: { urban: [.48, .49, .47], park: [.18, .35, .12], sand: [.58, .50, .34] },
    buildings: {
      residential: [[.82, .76, .59], [.76, .52, .43], [.48, .61, .45], [.72, .64, .57]],
      retail: [[.76, .67, .50], [.68, .60, .44]],
      commercial: [[.48, .56, .65], [.57, .63, .69]],
      civic: [[.74, .70, .60], [.61, .59, .53]],
    },
    streets: ['Chestnut Street', 'Divisadero Street', 'Fillmore Street', 'Marina Boulevard', 'Baker Street'],
    minBuildingArea: 45, buildingRadius: 35,
    trees: ['plane', 'plane', 'palm'], facades: ['stucco', 'stone', 'clapboard'],
    // Chestnut source lane, south of the Marina Green; never a shoreline centroid.
    spawn: { lat: 37.8005638, lon: -122.4383927, heading: 260.9 },
  },
  {
    id: 'presidio', name: 'Presidio',
    bbox: [-122.485, 37.7875, -122.4486, 37.8115], priority: 25,
    ground: { urban: [.39, .41, .37], park: [.14, .29, .09], scrub: [.31, .36, .19], sand: [.53, .45, .29] },
    buildings: {
      residential: [[.64, .38, .25], [.78, .72, .55], [.70, .57, .43]],
      civic: [[.70, .66, .55], [.59, .35, .24], [.79, .73, .61]],
      industrial: [[.43, .43, .37], [.53, .53, .46]],
      retail: [[.72, .64, .47]],
    },
    streets: ['Montgomery Street', 'Anza Avenue', 'Sheridan Avenue', 'Lincoln Boulevard', 'Presidio Boulevard', 'Arguello Boulevard', 'Mason Street'],
    minBuildingArea: 60, buildingRadius: 30,
    trees: ['cypress', 'cypress', 'plane'], facades: ['brick', 'stucco', 'stone'],
    spawn: { lat: 37.8007502, lon: -122.4586043, heading: 31.3 },
  },
  {
    // A smaller high-priority region keeps the arrival landscape distinct from
    // the Main Post. Do not decorate Presidio Parkway, bridge lanes or ramps.
    id: 'golden-gate-approach', name: 'Golden Gate Bridge approach',
    bbox: [-122.483, 37.8035, -122.469, 37.8115], priority: 70,
    ground: { urban: [.43, .44, .40], park: [.17, .32, .10], scrub: [.33, .37, .20], sand: [.57, .48, .31] },
    buildings: {
      residential: [[.78, .72, .54], [.65, .40, .29]],
      civic: [[.70, .66, .55], [.58, .35, .24]],
      retail: [[.72, .64, .47]],
    },
    streets: ['Lincoln Boulevard', 'Long Avenue', 'Marine Drive'],
    minBuildingArea: 60, buildingRadius: 25,
    trees: ['cypress', 'cypress', 'plane'], facades: ['brick', 'stone', 'stucco'],
    // Lincoln Blvd below the visitor area, not US 101 or Presidio Parkway.
    spawn: { lat: 37.8065608, lon: -122.4740283, heading: 330 },
  },
  {
    id: 'pacific-heights', name: 'Pacific Heights',
    bbox: [-122.4486, 37.786, -122.4238, 37.794], priority: 35,
    ground: { urban: [.49, .48, .46], park: [.17, .34, .11] },
    buildings: {
      residential: [[.79, .73, .58], [.48, .60, .43], [.62, .49, .60], [.72, .49, .44], [.68, .61, .53]],
      commercial: [[.49, .55, .63], [.58, .62, .68]],
      retail: [[.74, .65, .49], [.65, .57, .42]],
      civic: [[.73, .69, .59]],
    },
    streets: ['Fillmore Street', 'California Street', 'Jackson Street', 'Broadway', 'Divisadero Street'],
    minBuildingArea: 40, buildingRadius: 35,
    trees: ['plane', 'plane', 'cypress'], facades: ['clapboard', 'stone', 'stucco'],
    spawn: { lat: 37.7925780, lon: -122.4336552, heading: 81.1 },
  },
  {
    id: 'cow-hollow', name: 'Cow Hollow',
    bbox: [-122.4486, 37.794, -122.4238, 37.799], priority: 35,
    ground: { urban: [.47, .48, .46], park: [.18, .34, .12] },
    buildings: {
      residential: [[.80, .74, .56], [.69, .46, .39], [.46, .57, .41], [.61, .47, .59]],
      retail: [[.76, .67, .49], [.65, .58, .43]],
      commercial: [[.49, .55, .64]],
      civic: [[.72, .68, .57]],
    },
    streets: ['Union Street', 'Fillmore Street', 'Buchanan Street', 'Steiner Street', 'Greenwich Street'],
    minBuildingArea: 40, buildingRadius: 35,
    trees: ['plane', 'plane', 'cypress'], facades: ['clapboard', 'stucco', 'brick'],
    spawn: { lat: 37.7975472, lon: -122.4320693, heading: 260.9 },
  },
  {
    // Wins the overlapping Pacific Heights/Western Addition art regions.
    id: 'japantown', name: 'Japantown',
    bbox: [-122.4334, 37.7835, -122.4260, 37.7880], priority: 80,
    ground: { urban: [.51, .50, .47], park: [.17, .33, .12] },
    buildings: {
      residential: [[.77, .65, .53], [.66, .53, .45], [.55, .63, .50]],
      commercial: [[.50, .57, .65], [.57, .63, .69]],
      retail: [[.77, .68, .50], [.66, .58, .43]],
      civic: [[.75, .71, .62], [.59, .58, .54]],
    },
    streets: ['Post Street', 'Buchanan Street', 'Sutter Street', 'Webster Street', 'Fillmore Street'],
    minBuildingArea: 45, buildingRadius: 35,
    trees: ['plane'], facades: ['stone', 'concrete', 'stucco'],
    // Post rather than the Peace Plaza building/interior footprint.
    spawn: { lat: 37.7856106, lon: -122.4294421, heading: 81.0 },
  },
  {
    id: 'western-addition', name: 'Western Addition',
    bbox: [-122.4460, 37.7735, -122.4218, 37.7860], priority: 25,
    ground: { urban: [.44, .46, .45], park: [.16, .33, .10] },
    buildings: {
      residential: [[.74, .50, .43], [.45, .58, .41], [.62, .47, .60], [.81, .75, .56], [.65, .54, .47]],
      retail: [[.75, .66, .48], [.66, .59, .43]],
      commercial: [[.46, .53, .63]],
      civic: [[.72, .68, .57], [.64, .39, .27]],
      industrial: [[.47, .47, .40]],
    },
    streets: ['Fillmore Street', 'Divisadero Street', 'Golden Gate Avenue', 'McAllister Street', 'Turk Street', 'Steiner Street'],
    minBuildingArea: 40, buildingRadius: 35,
    trees: ['plane', 'plane', 'cypress'], facades: ['clapboard', 'brick', 'stucco'],
    spawn: { lat: 37.7795816, lon: -122.4320964, heading: 81.1 },
  },
];
