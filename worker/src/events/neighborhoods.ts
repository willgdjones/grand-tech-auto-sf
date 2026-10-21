import type { Coordinates } from './types';

/** Coarse gameplay centers, not building locations or authoritative boundaries. */
export const NEIGHBORHOODS: Readonly<Record<string, Coordinates>> = {
  'financial district': { lat: 37.7946, lon: -122.3999 },
  'fidi': { lat: 37.7946, lon: -122.3999 },
  'soma': { lat: 37.7786, lon: -122.4057 },
  'south of market': { lat: 37.7786, lon: -122.4057 },
  'mission district': { lat: 37.7599, lon: -122.4148 },
  'mission': { lat: 37.7599, lon: -122.4148 },
  'mission bay': { lat: 37.7706, lon: -122.3913 },
  'north beach': { lat: 37.8005, lon: -122.4091 },
  'embarcadero': { lat: 37.7955, lon: -122.3937 },
  'downtown': { lat: 37.788, lon: -122.4075 },
  'union square': { lat: 37.7879, lon: -122.4075 },
  'jackson square': { lat: 37.7966, lon: -122.4036 },
  'hayes valley': { lat: 37.7767, lon: -122.4241 },
  'duboce triangle': { lat: 37.7686, lon: -122.4324 },
  'castro': { lat: 37.7609, lon: -122.435 },
  'dogpatch': { lat: 37.759, lon: -122.3887 },
  'potrero hill': { lat: 37.7569, lon: -122.4008 },
  'south beach': { lat: 37.7817, lon: -122.3933 },
  'nob hill': { lat: 37.793, lon: -122.4161 },
  'russian hill': { lat: 37.8015, lon: -122.4197 },
  'marina': { lat: 37.8037, lon: -122.4368 },
  'pacific heights': { lat: 37.7925, lon: -122.4382 },
  'civic center': { lat: 37.7793, lon: -122.4193 },
  'chinatown': { lat: 37.7941, lon: -122.4078 },
  'golden gate park': { lat: 37.7694, lon: -122.4862 },
  'presidio': { lat: 37.7989, lon: -122.4662 },
};
export const SF_CENTER: Coordinates = { lat: 37.7749, lon: -122.4194 };

export function inferNeighborhood(text: string): string | undefined {
  const value = text.toLowerCase().replace(/[^a-z0-9]+/g, ' ');
  return Object.keys(NEIGHBORHOODS).sort((a, b) => b.length - a.length)
    .find(name => (` ${value} `).includes(` ${name} `));
}

export function inSanFrancisco(point: Coordinates): boolean {
  return Number.isFinite(point.lat) && Number.isFinite(point.lon)
    && point.lat >= 37.70 && point.lat <= 37.84 && point.lon >= -122.53 && point.lon <= -122.35;
}

function hash(value: string): number {
  let h = 2166136261;
  for (const ch of value) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}

/** Repeatable 80–180 m displacement around a PUBLIC coarse center, never a hidden address. */
export function fuzzCentroid(center: Coordinates, seed: string): Coordinates {
  const angle = hash(seed) / 0x100000000 * Math.PI * 2;
  const radius = 80 + hash(`${seed}:radius`) / 0x100000000 * 100;
  return {
    lat: center.lat + Math.cos(angle) * radius / 111_320,
    lon: center.lon + Math.sin(angle) * radius / (111_320 * Math.cos(center.lat * Math.PI / 180)),
  };
}
