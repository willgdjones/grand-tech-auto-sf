/** Public artifact contract. Distances are metres, +x east, +y up, +z south. */
export type XZ = [number, number];
export type XYZ = [number, number, number];
export type Bbox = readonly [west: number, south: number, east: number, north: number];
export type Bounds = readonly [minX: number, minZ: number, maxX: number, maxZ: number];
export type Polygon = XZ[][];
export type Tags = Record<string, string>;
export interface OsmCoordinate { lat: number; lon: number }
export interface OsmElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  tags?: Tags;
  nodes?: number[];
  geometry?: OsmCoordinate[];
  members?: { type: 'node' | 'way' | 'relation'; ref: number; role: string; geometry?: OsmCoordinate[] }[];
}
export interface OsmExtract {
  elements: OsmElement[];
  osm3s?: { timestamp_osm_base?: string };
  remark?: string;
}
export interface DataSfBuilding {
  sf16_bldgid: string;
  shape: { type: 'MultiPolygon'; coordinates: Polygon[] };
  hgt_median_m?: string;
  hgt_mediancm?: string;
  gnd1st_delta?: string;
  hgt_maxcm?: string;
  data_as_of?: string;
}
export interface RoadPoint { id: string; x: number; z: number; control?: 'signal' | 'stop'; yield?: boolean }
export interface Road {
  id: string; osmWay: number; tags: Tags; points: RoadPoint[]; width: number;
  /** Dense, smoothed centreline heights prepared from the original DEM before carving. */
  profile?: XYZ[];
}
export interface Building {
  id: string;
  polygon: Polygon;
  height: number;
  base: number;
  foundation: number;
  heightSource: 'datasf' | 'osm-height' | 'osm-levels' | 'fallback' | 'lidar';
  /** gtasf-6w9a: LiDAR roof shape (MAP_LIDAR_ROOFS), visual-only extras on top of the body. */
  roofShape?: import('./lidarRoofs').LidarRoof;
  colour: [number, number, number];
  landuse: string;
}
export interface RoadNode {
  id: string;
  x: number;
  y: number;
  z: number;
  osmNode: string;
  control?: 'signal' | 'stop';
  yield?: boolean;
}
export interface RoadEdge {
  id: string;
  from: string;
  to: string;
  lengthM: number;
  speedMps: number;
  lane: number;
  points: XYZ[];
  kind: 'lane' | 'connector';
  osmWay: number;
  name: string;
  inferredLanes: boolean;
  layer: number;
  bridge: boolean;
  tunnel: boolean;
  next?: string[];
}
export interface RoadGraph {
  version: 1;
  nodes: RoadNode[];
  edges: RoadEdge[];
  warnings: string[];
}
export interface HeightSampler { sample(x: number, z: number): number }
export interface SourceRecord {
  key: string;
  url: string;
  sha256: string;
  bytes: number;
  file: string;
  fetchedAt: string;
  imagerySources?: string;
}
export interface SourceManifest {
  version: 1;
  configKey: string;
  records: SourceRecord[];
  osmTimestamp?: string;
  dataSfAsOf: string[];
}
export interface Artifact {
  path: string;
  bytes: number;
  gzipBytes: number;
  sha256: string;
  /** Optional reversible container; hashes distinguish HTTP body from restored source bytes. */
  transport?: 'predictive-v1';
  decodedBytes?: number;
  decodedSha256?: string;
  meshEncoding?: 'triangles-v1' | 'recipes-v1' | 'joins-v1' | 'height-predicted-v1' | 'surfaces-v1';
}
export interface ChunkRecord {
  id: string;
  detail?: 'low';
  x: number;
  z: number;
  bounds: Bounds;
  lods: [Artifact, Artifact];
  terrain: Artifact;
  collision: Artifact;
  /** graphicsV2 phase 2: NAIP JPEG covering exactly `bounds`, north-up (top row = min z). */
  aerial?: Artifact;
  triangles: [number, number];
}
export interface MapManifest {
  version:1;
  requiredFeatures?: ['compactMapAssets'];
  generator:string;
  area:string;
  frame:{origin:{lat:number;lon:number};gridRotationDeg:number};
  axes:{x:'east';y:'up';z:'south';units:'metres'};
  bounds:Bounds;
  chunkSize:number;
  terrain:{step:number;format:'GTHF-v1';vertical:'source DEM metres; road-carved'};
  roadGraph:Artifact & {encoding?:'roadpack-v1'};
  /** gtasf-0k01: spawn-area subset of roadGraph (tools/map/roadgraph-subset.mts), loaded first by flags.nearRoadGraph. */
  roadGraphNear?:Artifact & {encoding:'roadpack-v1';sourceSha256:string;coverage:{id:string;x:number;z:number;radiusM:number}[];parts?:(Artifact & {id:string;encoding:'roadpack-v1'})[]};
  /** Existing cinematic/local-route consumers still request these pinned JSON artifacts. */
  runtime?:Record<string,Artifact>;
  neighbourhoods?:Artifact;
  coastline?:Artifact;
  chunks:ChunkRecord[];
  sourceDigests:{key:string;sha256:string}[];
  stats:{roads:number;buildings:number;lanes:number;signals:number;stops:number;gzipBytes:number;budgetBytes:number;withinBudget:boolean};
  warnings:string[];
  attribution:{label:string;url:string}[];
}
