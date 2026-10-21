import type { DistrictProfile } from './types';

/** Authored art regions, not administrative boundaries. Source OSM landcover,
 * building use/heights and road geometry remain authoritative inside each box.
 * Linear RGB preserves the facade classifier's commercial/retail ratio bands.
 * Only the named street frontages retain smaller houses in the coarse city bake.
 */
export const DISTRICTS_WEST: readonly DistrictProfile[] = [
  {
    id: 'haight-ashbury', name: 'Haight-Ashbury',
    bbox: [-122.454, 37.7668, -122.437, 37.7742], priority: 55,
    // Panhandle and park edges stay green only where source landcover says so.
    ground: { urban: [0.44, 0.43, 0.41], park: [0.20, 0.37, 0.15] },
    buildings: {
      residential: [[0.79, 0.73, 0.64], [0.57, 0.66, 0.52], [0.68, 0.53, 0.63], [0.76, 0.49, 0.43]],
      retail: [[0.76, 0.67, 0.48], [0.65, 0.57, 0.39]],
      commercial: [[0.54, 0.62, 0.69]], civic: [[0.76, 0.72, 0.61]],
    },
    streets: ['Haight Street', 'Ashbury Street', 'Masonic Avenue', 'Stanyan Street', 'Cole Street', 'Clayton Street', 'Waller Street'],
    minBuildingArea: 40, buildingRadius: 30,
    trees: ['plane', 'cypress', 'plane'],
    // Midpoint of sourced OSM Haight Street way 417979722, facing west along it.
    spawn: { lat: 37.7700712, lon: -122.446512, heading: 260.9 },
    facades: ['clapboard', 'stucco', 'brick', 'mural'],
  },
  {
    id: 'richmond', name: 'Richmond',
    bbox: [-122.513, 37.772, -122.458, 37.7895], priority: 20,
    ground: { urban: [0.43, 0.45, 0.45], park: [0.20, 0.37, 0.16], sand: [0.68, 0.60, 0.43] },
    buildings: {
      residential: [[0.76, 0.71, 0.58], [0.55, 0.64, 0.49], [0.64, 0.49, 0.55], [0.70, 0.47, 0.36]],
      retail: [[0.76, 0.67, 0.48], [0.65, 0.57, 0.39]],
      commercial: [[0.52, 0.61, 0.69]], civic: [[0.77, 0.73, 0.62]],
    },
    streets: ['Geary Boulevard', 'Clement Street', 'Balboa Street', 'Arguello Boulevard', '25th Avenue'],
    minBuildingArea: 40, buildingRadius: 35,
    trees: ['plane', 'cypress', 'plane'],
    spawn: { lat: 37.7827028, lon: -122.4644383, heading: 270 },
    facades: ['stucco', 'clapboard', 'brick'],
  },
  {
    id: 'sunset', name: 'Sunset',
    bbox: [-122.5125, 37.735, -122.4463, 37.7664], priority: 20,
    ground: { urban: [0.46, 0.47, 0.45], park: [0.23, 0.39, 0.17], sand: [0.72, 0.64, 0.47] },
    buildings: {
      residential: [[0.82, 0.77, 0.65], [0.60, 0.69, 0.58], [0.73, 0.53, 0.59], [0.70, 0.75, 0.70]],
      retail: [[0.78, 0.69, 0.50], [0.70, 0.62, 0.43]],
      commercial: [[0.58, 0.64, 0.71]], civic: [[0.78, 0.74, 0.62]],
    },
    streets: ['Irving Street', 'Judah Street', 'Noriega Street', 'Taraval Street', '9th Avenue', '19th Avenue'],
    minBuildingArea: 35, buildingRadius: 35,
    trees: ['plane', 'cypress'],
    spawn: { lat: 37.7636222, lon: -122.4769949, heading: 90 },
    facades: ['stucco', 'clapboard'],
  },
  {
    id: 'golden-gate-park', name: 'Golden Gate Park',
    bbox: [-122.5105, 37.7640, -122.4407, 37.7748], priority: 35,
    // An urban fallback is deliberate: only source park/wood polygons turn green.
    // The box also touches residential blocks; no rectangular lawn is invented.
    ground: { urban: [0.42, 0.44, 0.41], park: [0.17, 0.36, 0.13], scrub: [0.28, 0.36, 0.16] },
    buildings: {
      residential: [[0.73, 0.68, 0.54], [0.57, 0.65, 0.50]],
      civic: [[0.72, 0.69, 0.57], [0.51, 0.38, 0.28], [0.80, 0.77, 0.69]],
      retail: [[0.70, 0.62, 0.43]],
    },
    streets: ['John F Kennedy Drive', 'Martin Luther King Junior Drive', 'Nancy Pelosi Drive', 'Music Concourse Drive', 'Stanyan Street'],
    minBuildingArea: 50, buildingRadius: 35,
    trees: ['cypress', 'plane', 'cypress'],
    // Drivable south entrance beside the park, not a snap across a lake or onto JFK.
    spawn: { lat: 37.7659905, lon: -122.4667922, heading: 0 },
    facades: ['stone', 'stucco', 'concrete'],
  },
  {
    id: 'ocean-beach', name: 'Ocean Beach',
    bbox: [-122.5165, 37.7285, -122.5035, 37.7794], priority: 45,
    // Sand is selected by natural=beach/sand, not merely by proximity to the ocean.
    ground: { urban: [0.49, 0.49, 0.45], park: [0.28, 0.39, 0.19], sand: [0.76, 0.67, 0.48], scrub: [0.37, 0.41, 0.21] },
    buildings: {
      residential: [[0.82, 0.78, 0.69], [0.61, 0.69, 0.59], [0.73, 0.54, 0.58]],
      retail: [[0.76, 0.67, 0.49]], civic: [[0.77, 0.72, 0.60]],
    },
    streets: ['Great Highway', 'La Playa Street', 'Fulton Street', 'Lincoln Way', 'Sloat Boulevard'],
    minBuildingArea: 40, buildingRadius: 30,
    trees: ['cypress'],
    // La Playa/Fulton keeps the arrival on the neighbourhood side of the dunes.
    spawn: { lat: 37.7724950, lon: -122.5098072, heading: 270 },
    facades: ['stucco', 'clapboard', 'stone'],
  },
  {
    id: 'twin-peaks', name: 'Twin Peaks',
    bbox: [-122.4616, 37.7455, -122.4388, 37.7591], priority: 40,
    ground: { urban: [0.41, 0.43, 0.41], park: [0.23, 0.35, 0.15], scrub: [0.38, 0.42, 0.22] },
    buildings: {
      residential: [[0.77, 0.73, 0.64], [0.56, 0.63, 0.51], [0.66, 0.51, 0.41]],
      civic: [[0.57, 0.55, 0.49]], commercial: [[0.54, 0.62, 0.69]],
    },
    streets: ['Twin Peaks Boulevard', 'Christmas Tree Point Road', 'Clarendon Avenue', 'Portola Drive'],
    minBuildingArea: 50, buildingRadius: 30,
    trees: ['cypress', 'cypress', 'plane'],
    spawn: { lat: 37.7539963, lon: -122.4474328, heading: 90 },
    facades: ['stucco', 'concrete', 'clapboard'],
  },
];
