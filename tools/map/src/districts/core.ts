import type { DistrictProfile } from './types';

/** PLAN-v2.1 / district d1. Original palettes and art-direction regions; no new map sources. */
export const DISTRICTS_CORE: readonly DistrictProfile[] = [
  {
    id: 'moscone', name: 'Moscone', bbox: [-122.4055, 37.781, -122.3975, 37.787], priority: 90,
    ground: { urban: [.54,.55,.53], park: [.22,.43,.18] }, defaultBuildingUse: 'civic',
    buildings: { civic: [[.72,.70,.62],[.66,.68,.66]], commercial: [[.53,.64,.75],[.61,.70,.78]],
      retail: [[.74,.65,.51],[.65,.57,.44]] },
    streets: ['Howard Street','Folsom Street','3rd Street','4th Street'],
    minBuildingArea: 50, buildingRadius: 35, trees: ['plane','palm'],
    spawn: { lat: 37.7841202, lon: -122.4014765, heading: 45 }, facades: ['stone','glass','concrete'],
  },
  {
    id: 'fidi', name: 'Financial District', bbox: [-122.4085, 37.788, -122.393, 37.798], priority: 80,
    ground: { urban: [.49,.52,.54], park: [.22,.40,.20] }, defaultBuildingUse: 'commercial',
    buildings: { commercial: [[.51,.63,.76],[.64,.72,.79],[.47,.55,.66]],
      civic: [[.79,.76,.67],[.71,.67,.62]], retail: [[.74,.65,.51],[.68,.60,.48]] },
    streets: ['Montgomery Street','California Street','Sansome Street','Battery Street','Pine Street','Clay Street','Market Street'],
    minBuildingArea: 60, buildingRadius: 35, trees: ['plane'],
    spawn: { lat: 37.7933948, lon: -122.4028417, heading: 180 }, facades: ['glass','stone','brick'],
  },
  {
    id: 'mission', name: 'Mission', bbox: [-122.426, 37.747, -122.406, 37.7705], priority: 70,
    ground: { urban: [.49,.47,.43], park: [.24,.44,.18] }, defaultBuildingUse: 'residential',
    buildings: { residential: [[.82,.65,.49],[.76,.56,.48],[.52,.65,.49],[.69,.55,.47]],
      retail: [[.79,.69,.53],[.67,.59,.45]], industrial: [[.48,.48,.42],[.56,.56,.48]] },
    streets: ['Mission Street','Valencia Street','16th Street','18th Street','24th Street','Capp Street'],
    minBuildingArea: 35, buildingRadius: 30, trees: ['plane','palm'],
    spawn: { lat: 37.7598998, lon: -122.4214024, heading: 0 }, facades: ['stucco','clapboard','mural','brick'],
  },
  {
    id: 'dogpatch', name: 'Dogpatch', bbox: [-122.397, 37.748, -122.383, 37.768], priority: 75,
    ground: { urban: [.43,.45,.46], park: [.25,.43,.20] }, defaultBuildingUse: 'industrial',
    buildings: { industrial: [[.48,.48,.41],[.57,.57,.48],[.40,.40,.35]],
      residential: [[.78,.62,.46],[.70,.55,.43]], commercial: [[.54,.62,.69],[.47,.56,.65]],
      retail: [[.72,.63,.47],[.64,.56,.43]] },
    streets: ['3rd Street','Illinois Street','22nd Street','20th Street','Tennessee Street','Indiana Street'],
    minBuildingArea: 45, buildingRadius: 35, trees: ['plane','cypress'],
    spawn: { lat: 37.7602018, lon: -122.3886700, heading: 0 }, facades: ['brick','concrete','clapboard'],
  },
  {
    // A compact art region around Hayes/Octavia, above the broader Western
    // Addition and SoMa profiles. Keep source retail tags for shop floors;
    // neighbouring painted homes must not become office glass or storefronts.
    id: 'hayes-valley', name: 'Hayes Valley', bbox: [-122.429, 37.7725, -122.4215, 37.7805], priority: 65,
    ground: { urban: [.50,.50,.47], park: [.18,.37,.13] }, defaultBuildingUse: 'residential',
    buildings: { residential: [[.81,.75,.58],[.48,.61,.44],[.74,.50,.43],[.62,.47,.60]],
      retail: [[.75,.66,.49],[.66,.58,.43]], commercial: [[.50,.58,.67]],
      civic: [[.74,.70,.61],[.64,.60,.54]] },
    streets: ['Hayes Street','Octavia Street','Octavia Boulevard','Gough Street','Laguna Street','Buchanan Street','Fell Street','Oak Street'],
    minBuildingArea: 35, buildingRadius: 30, trees: ['plane'],
    // Hayes Street surface lane west of Octavia; sourced from packed graph
    // 5763c53d, outside the Patricia's Green park/building interiors.
    spawn: { lat: 37.7767159, lon: -122.4244630, heading: 260.9 }, facades: ['clapboard','stucco','brick'],
  },
  {
    id: 'soma', name: 'SoMa', bbox: [-122.422, 37.7675, -122.389, 37.789], priority: 40,
    ground: { urban: [.46,.47,.48], park: [.22,.42,.18] }, defaultBuildingUse: 'industrial',
    buildings: { industrial: [[.50,.50,.42],[.42,.42,.36],[.59,.59,.50]],
      commercial: [[.49,.58,.69],[.58,.68,.77]], retail: [[.73,.64,.49],[.66,.58,.45]],
      residential: [[.77,.59,.46],[.69,.57,.46]] },
    streets: ['Howard Street','Folsom Street','Harrison Street','Brannan Street','2nd Street','3rd Street','4th Street','7th Street'],
    minBuildingArea: 50, buildingRadius: 35, trees: ['plane','palm'],
    spawn: { lat: 37.7784664, lon: -122.4036573, heading: 45 }, facades: ['brick','concrete','glass'],
  },
];
