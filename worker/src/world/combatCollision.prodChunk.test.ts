/**
 * Live PvP line of sight against REAL published map data: the prod collision chunk 4_-6 (Ferry / Embarcadero, as
 * served at /map/releases/<sha>/chunks/4_-6/collision.json) loaded through CombatCollision in the published format
 * (leading-slash path, JSON body), then a server-validated rifle shot through WorldCombat.fire — the exact path a PvP
 * hit takes in WorldDO. Before e4652fe2 this collision never loaded in prod, so walls never blocked a hit.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { WEAPON_ORDER } from '@gtasf/shared/combat/weapons';
import { CombatCollision } from './combatCollision';
import { WorldCombat } from './combat';

const CHUNK = readFileSync(new URL('./__fixtures__/ferry-chunk-4_-6.collision.json', import.meta.url));
const PATH = '/map/releases/prod/chunks/4_-6/collision.json';
const MANIFEST = JSON.stringify({ version: 1, chunkSize: 256, chunks: [{ id: '4_-6', x: 4, z: -6, collision: { path: PATH, bytes: CHUNK.length, gzipBytes: 0, sha256: 'x' } }] });
const buf = (b: Uint8Array) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
const assets = { get: async (key: string) => key === 'map/lombard/manifest.json' ? { httpMetadata: {}, arrayBuffer: async () => buf(new TextEncoder().encode(MANIFEST)) }
  : key === PATH.slice(1) ? { httpMetadata: {}, arrayBuffer: async () => buf(CHUNK) } : null } as unknown as R2Bucket;
const RIFLE = WEAPON_ORDER.indexOf('rifle'); // 120 m range

async function shoot(from: [number, number], to: [number, number]) {
  const collision = new CombatCollision(assets, 'map/lombard/manifest.json');
  await collision.warm(from[0], from[1]);
  const near = collision.near(from[0], from[1]);
  const combat = new WorldCombat();
  const dir: [number, number, number] = [to[0] - from[0], 0, to[1] - from[1]];
  const result = combat.fire(1, { x: from[0] * 100, y: 0, z: from[1] * 100 }, { weapon: RIFLE, dir }, [{ id: 2, x: to[0], y: 1.4, z: to[1] }], 0, { collision: near });
  return { near, result };
}

describe('live PvP line of sight vs the real Ferry-area prod chunk', () => {
  it('loads the published chunk (buildings present)', async () => {
    const { near } = await shoot([1220, -1389], [1310, -1389]);
    expect(near?.buildings.length).toBeGreaterThan(5);
  });
  it('a rifle shot through the 5 m building at (1264,-1389) does NOT hit the player behind it', async () => {
    const { result } = await shoot([1220, -1389], [1310, -1389]); // 90 m, inside rifle range, building in between
    expect(result?.targetId).toBe(0);
  });
  it('control: the same rifle shot with a clear line hits', async () => {
    const { result } = await shoot([1175, -1389], [1230, -1389]); // 55 m, stops short of the building
    expect(result?.targetId).toBe(2);
  });
});
