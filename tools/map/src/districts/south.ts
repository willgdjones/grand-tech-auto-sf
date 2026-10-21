import type { DistrictProfile } from './types';

/** Authored street-scale treatments, not surveyed paint or administrative boundaries.
 * Colours are linear RGB. Keep the legacy facade classifier's use bands until
 * facade style is carried independently of the baked colour (see DISTRICTS-SOUTH.md).
 * Source OSM building types, DataSF heights and park polygons remain authoritative.
 */
export const DISTRICTS_SOUTH: readonly DistrictProfile[] = [
  {
    id: 'bernal-heights', name: 'Bernal Heights',
    bbox: [-122.4286, 37.7315, -122.4036, 37.7495], priority: 30,
    ground: { urban: [0.40, 0.39, 0.37], park: [0.22, 0.42, 0.16], scrub: [0.38, 0.40, 0.20] },
    buildings: {
      residential: [[0.83, 0.63, 0.43], [0.68, 0.45, 0.39], [0.51, 0.63, 0.46], [0.71, 0.64, 0.62]],
      retail: [[0.77, 0.68, 0.49], [0.68, 0.60, 0.42]],
      civic: [[0.72, 0.68, 0.57]],
    },
    streets: ['Cortland Avenue', 'Folsom Street', 'Bernal Heights Boulevard', 'Anderson Street'],
    minBuildingArea: 45, buildingRadius: 35,
    trees: ['plane', 'plane', 'cypress'],
    spawn: { lat: 37.7390657, lon: -122.4164117, heading: 90 },
    facades: ['clapboard', 'stucco', 'brick'],
  },
  {
    id: 'potrero-hill', name: 'Potrero Hill',
    // Stop at the eastern hillside; Dogpatch's industrial flats have their own profile.
    bbox: [-122.4065, 37.7494, -122.3925, 37.7673], priority: 30,
    ground: { urban: [0.38, 0.39, 0.40], park: [0.24, 0.43, 0.18] },
    buildings: {
      residential: [[0.79, 0.61, 0.45], [0.62, 0.43, 0.38], [0.54, 0.65, 0.51], [0.64, 0.52, 0.64]],
      industrial: [[0.46, 0.46, 0.39], [0.58, 0.58, 0.50]],
      commercial: [[0.48, 0.56, 0.65], [0.60, 0.65, 0.72]],
      retail: [[0.73, 0.65, 0.47]],
    },
    streets: ['18th Street', '20th Street', 'Connecticut Street', 'Rhode Island Street', 'De Haro Street'],
    minBuildingArea: 55, buildingRadius: 35,
    trees: ['plane', 'plane', 'cypress'],
    spawn: { lat: 37.7625154, lon: -122.3973504, heading: 270 },
    facades: ['stucco', 'clapboard', 'brick', 'concrete'],
  },
  {
    id: 'bayview', name: 'Bayview',
    bbox: [-122.4071, 37.7084, -122.3570, 37.7532], priority: 20,
    ground: { urban: [0.37, 0.38, 0.39], park: [0.22, 0.40, 0.17], scrub: [0.40, 0.38, 0.24] },
    buildings: {
      residential: [[0.76, 0.58, 0.40], [0.69, 0.43, 0.35], [0.48, 0.61, 0.45], [0.63, 0.51, 0.62]],
      industrial: [[0.40, 0.40, 0.34], [0.51, 0.51, 0.43], [0.62, 0.62, 0.54]],
      retail: [[0.74, 0.66, 0.46], [0.63, 0.56, 0.40]],
      commercial: [[0.48, 0.55, 0.65]],
    },
    // Source spelling is numeric: the OSM corridor is "3rd Street".
    streets: ['3rd Street', 'Revere Avenue', 'Palou Avenue', 'Oakdale Avenue', 'Quesada Avenue'],
    minBuildingArea: 60, buildingRadius: 35,
    trees: ['plane', 'cypress', 'plane'],
    spawn: { lat: 37.7335063, lon: -122.3912652, heading: 330 },
    facades: ['stucco', 'brick', 'concrete', 'clapboard'],
  },
  {
    id: 'excelsior', name: 'Excelsior',
    bbox: [-122.4543, 37.7082, -122.4145, 37.7320], priority: 30,
    ground: { urban: [0.41, 0.40, 0.38], park: [0.23, 0.42, 0.17] },
    buildings: {
      residential: [[0.79, 0.62, 0.43], [0.70, 0.48, 0.44], [0.53, 0.64, 0.48], [0.64, 0.52, 0.65]],
      retail: [[0.75, 0.66, 0.46], [0.67, 0.59, 0.42]],
      civic: [[0.73, 0.69, 0.59]],
    },
    streets: ['Mission Street', 'Persia Avenue', 'Excelsior Avenue', 'Brazil Avenue', 'Geneva Avenue'],
    minBuildingArea: 45, buildingRadius: 35,
    trees: ['plane', 'cypress', 'plane'],
    spawn: { lat: 37.7232944, lon: -122.4358108, heading: 320 },
    facades: ['stucco', 'clapboard', 'brick'],
  },
  {
    id: 'glen-park', name: 'Glen Park',
    // Give the village precedence where its art envelope meets Noe Valley.
    bbox: [-122.4516, 37.7332, -122.4233, 37.7466], priority: 40,
    ground: { urban: [0.37, 0.39, 0.38], park: [0.17, 0.35, 0.13], scrub: [0.30, 0.36, 0.19] },
    buildings: {
      residential: [[0.74, 0.60, 0.43], [0.52, 0.62, 0.46], [0.67, 0.49, 0.42], [0.69, 0.65, 0.64]],
      retail: [[0.71, 0.63, 0.45], [0.77, 0.68, 0.48]],
      civic: [[0.64, 0.61, 0.53]],
    },
    streets: ['Diamond Street', 'Chenery Street', 'Bosworth Street', 'Ohlone Way'],
    minBuildingArea: 45, buildingRadius: 35,
    trees: ['cypress', 'plane', 'cypress'],
    spawn: { lat: 37.7345963, lon: -122.4338374, heading: 0 },
    facades: ['clapboard', 'stucco', 'stone'],
  },
  {
    id: 'noe-valley', name: 'Noe Valley',
    bbox: [-122.4474, 37.7415, -122.4213, 37.7566], priority: 30,
    ground: { urban: [0.42, 0.41, 0.39], park: [0.23, 0.43, 0.17] },
    buildings: {
      residential: [[0.85, 0.65, 0.48], [0.74, 0.51, 0.48], [0.55, 0.68, 0.52], [0.67, 0.55, 0.68]],
      retail: [[0.79, 0.70, 0.50], [0.70, 0.62, 0.44]],
      civic: [[0.77, 0.73, 0.64]],
    },
    streets: ['24th Street', 'Church Street', 'Noe Street', 'Castro Street'],
    minBuildingArea: 45, buildingRadius: 35,
    trees: ['plane', 'plane', 'cypress'],
    spawn: { lat: 37.7514563, lon: -122.4317960, heading: 90 },
    facades: ['clapboard', 'stucco', 'stone'],
  },
  {
    id: 'castro', name: 'Castro',
    bbox: [-122.4479, 37.7554, -122.4255, 37.7696], priority: 40,
    ground: { urban: [0.40, 0.40, 0.39], park: [0.23, 0.43, 0.18] },
    buildings: {
      residential: [[0.84, 0.61, 0.43], [0.74, 0.46, 0.46], [0.53, 0.67, 0.49], [0.66, 0.52, 0.67]],
      retail: [[0.79, 0.70, 0.49], [0.68, 0.60, 0.42]],
      commercial: [[0.48, 0.57, 0.68]],
      civic: [[0.74, 0.70, 0.60]],
    },
    streets: ['Castro Street', '18th Street', 'Market Street', 'Collingwood Street'],
    minBuildingArea: 45, buildingRadius: 35,
    trees: ['plane', 'plane', 'cypress'],
    spawn: { lat: 37.7608008, lon: -122.4349871, heading: 0 },
    facades: ['clapboard', 'stucco', 'brick', 'stone'],
  },
];
