/** Authored art regions, not administrative boundaries. Coordinates are WGS84. */
export type Colour = readonly [number, number, number];
export type BuildingUse = 'residential' | 'commercial' | 'retail' | 'industrial' | 'religious' | 'civic';
export type FacadeStyle = 'brick' | 'stone' | 'stucco' | 'clapboard' | 'glass' | 'concrete' | 'mural';
export interface DistrictProfile {
  id: string;
  name: string;
  bbox: readonly [west: number, south: number, east: number, north: number];
  /** Highest priority wins where art regions overlap. */
  priority: number;
  /** Linear RGB, like baked COLOR_0. Source water and park polygons take precedence. */
  ground: { urban: Colour; park: Colour; sand?: Colour; scrub?: Colour };
  /** Keep land-use channel ratios compatible with both procedural facade paths. */
  buildings: Partial<Record<BuildingUse, readonly Colour[]>>;
  defaultBuildingUse?: BuildingUse;
  /** Exact OSM street names: retain small buildings and paving near these streets only. */
  streets: readonly string[];
  minBuildingArea: number;
  buildingRadius: number;
  trees: readonly ('plane' | 'palm' | 'cypress')[];
  /** Arrival hint, always snapped to the real sourced road graph before placement. */
  spawn: { lat: number; lon: number; heading?: number };
  facades: readonly FacadeStyle[];
}
