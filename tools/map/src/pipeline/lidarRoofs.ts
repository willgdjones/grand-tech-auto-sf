import { readFileSync } from 'node:fs';
/**
 * gtasf-6w9a: optional per-footprint LiDAR roof data for the bake (tools/map/lidar/citywide.py --merge ->
 * tools/map/out/lidar/roofs.json). Opt-in with MAP_LIDAR_ROOFS=<path>; unset = no change to any bake.
 * Heights are metres above the LiDAR ground around the footprint; shapes add visual-only roof detail.
 */
export interface LidarRoof {
  id: string; type: 'flat' | 'flat-parapet' | 'gable' | 'stepped' | 'pitched' | 'complex';
  h: number; p95?: number; parapet?: number; ridge?: number; axis?: number;
  upper?: { h: number; x: number; z: number; l: number; w: number; axis: number };
}
let table: Map<string, LidarRoof> | null | undefined;
export function lidarRoof(sf16Id: string): LidarRoof | undefined {
  if (table === undefined) {
    const path = process.env.MAP_LIDAR_ROOFS;
    if (!path) table = null;
    else {
      const data = JSON.parse(readFileSync(path, 'utf8')) as { buildings: LidarRoof[] };
      table = new Map(data.buildings.filter(b => Number.isFinite(b.h) && b.h > 2).map(b => [String(b.id), b]));
      console.log(`MAP_LIDAR_ROOFS: ${table.size} LiDAR roofs from ${path}`);
    }
  }
  return table?.get(sf16Id);
}
