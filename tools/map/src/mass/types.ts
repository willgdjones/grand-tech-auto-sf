import type { Polygon } from '../geo/features';

export type BuildingRole = 'hero' | 'backdrop' | 'landmark-footprint';
export interface SourceIds {
  bins: string[];
  osm: string[];
  features: string[];
}
export interface CleanBuilding {
  key: string;
  role: BuildingRole;
  sourceIds: SourceIds;
  polygon: Polygon;
  properties: Record<string, unknown>;
}
export interface Setback {
  atM: number;
  insetM: number;
  edges: number[];
}
export interface MassingOverride {
  building: string;
  height?: number;
  levels?: number;
  floorsPerBand?: number;
  setbacks?: Setback[];
  lowConfidenceReviewed?: boolean;
  reason: string;
  author: string;
}
export interface LandmarkInput {
  key: string;
  massing: { source: 'nyc3d' | 'gltf' | 'procedural' | 'footprint'; bins: string[] };
}
export type LowConfidenceReason = 'missing' | 'zero' | 'over400' | 'over3xMedian';
