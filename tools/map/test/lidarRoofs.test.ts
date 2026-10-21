import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { addBuildings, ChunkMeshes } from '../src/pipeline/meshes';
import type { Building } from '../src/pipeline/types';

const building = (roofShape?: Building['roofShape']): Building => ({
  id: 'datasf:1:0', polygon: [[[100, 100], [112, 100], [112, 120], [100, 120]]], height: 10, base: 0, foundation: -0.3,
  heightSource: 'lidar', colour: [.7, .6, .5], landuse: 'residential', ...(roofShape ? { roofShape } : {}),
});
const triangles = (b: Building) => { const m = new ChunkMeshes([0, 0, 256, 256]); addBuildings(m, [b], 0); return m.chunks.get('0_0')!.buildings.indices.length / 3; };

describe('LiDAR roofs in the bake (gtasf-6w9a)', () => {
  it('adds parapet walls, a gable cap and an upper tier only for the matching roof types', () => {
    const plain = triangles(building());
    expect(triangles(building({ id: '1', type: 'flat', h: 10 }))).toBe(plain);
    expect(triangles(building({ id: '1', type: 'flat-parapet', h: 10, parapet: 12 }))).toBe(plain + 4 * 4);
    expect(triangles(building({ id: '1', type: 'gable', h: 10, ridge: 14, axis: Math.PI / 2 }))).toBe(plain + 6);
    expect(triangles(building({ id: '1', type: 'stepped', h: 10, upper: { h: 20, x: 106, z: 110, l: 6, w: 4, axis: 0 } }))).toBe(plain + 4 * 4 + 4);
    // A parapet / ridge that is not above the main roof adds nothing.
    expect(triangles(building({ id: '1', type: 'flat-parapet', h: 10, parapet: 10.1 }))).toBe(plain);
  });

  it('lidarRoof() reads MAP_LIDAR_ROOFS once and ignores implausible heights', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'lidar-roofs-')), path = join(dir, 'roofs.json');
    writeFileSync(path, JSON.stringify({ buildings: [{ id: '42', type: 'flat', h: 11.5 }, { id: '43', type: 'flat', h: 1 }] }));
    vi.stubEnv('MAP_LIDAR_ROOFS', path); vi.resetModules();
    const { lidarRoof } = await import('../src/pipeline/lidarRoofs');
    expect(lidarRoof('42')?.h).toBe(11.5);
    expect(lidarRoof('43')).toBeUndefined();
    expect(lidarRoof('99')).toBeUndefined();
    vi.unstubAllEnvs();
  });
});
