/** Acquisition URLs and attribution are part of the reproducible map contract, not runtime APIs. */
export const SOURCE_CATALOG = {
  osm: {
    endpoint: 'https://overpass-api.de/api/interpreter',
    cityExtract: 'https://download.geofabrik.de/north-america/us/california/norcal-latest.osm.pbf',
    licence: 'ODbL-1.0',
    attribution: '© OpenStreetMap contributors',
    evidence: 'https://www.openstreetmap.org/copyright',
  },
  terrain: {
    template: 'https://elevation-tiles-prod.s3.amazonaws.com/terrarium/{z}/{x}/{y}.png',
    units: 'metres',
    decode: 'R * 256 + G + B / 256 - 32768',
    licence: 'Source-dependent; SF sample uses USGS NED/3DEP topobathy',
    attribution: 'Mapzen Terrain Tiles; USGS 3DEP; NOAA',
    evidence: 'https://github.com/tilezen/joerd/blob/master/docs/attribution.md',
  },
  buildings: {
    endpoint: 'https://data.sf.gov/resource/ynuv-fyni.json',
    metadata: 'https://data.sf.gov/api/views/ynuv-fyni.json',
    licence: 'PDDL',
    attribution: 'City and County of San Francisco — DataSF Building Footprints',
    heightField: 'hgt_median_m',
    units: 'metres above local ground',
    evidence: 'https://data.sf.gov/d/ynuv-fyni',
  },
} as const;
