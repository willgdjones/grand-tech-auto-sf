import { describe, expect, it, vi } from 'vitest';
// A mutable copy of the flags so the serverTerrainLos tests can switch it on (the real object is frozen).
vi.mock('@gtasf/shared/flags', async orig => { const actual = await orig<typeof import('@gtasf/shared/flags')>(); return { ...actual, flags: { ...actual.flags } }; });
import { encodeMapCollision, type MapCollision } from '@gtasf/shared/mapCollision';
import { lineOfSight } from '@gtasf/shared/combat/rayVsWorld';
import { CombatCollision, mergeChunks, COLLISION_CACHE_MAX, policeLineClear } from './combatCollision';

const collisionBin = (c: MapCollision): ArrayBuffer => {
  const bytes = encodeMapCollision(new TextEncoder().encode(JSON.stringify(c)));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
};
const utf8 = (s: string): ArrayBuffer => { const b = new TextEncoder().encode(s); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };

function mockAssets(files: Record<string, ArrayBuffer>): R2Bucket {
  return {
    get: async (key: string) => files[key] ? ({ httpMetadata: {}, arrayBuffer: async () => files[key] }) : null,
  } as unknown as R2Bucket;
}

// A wall in chunk 0:0 at x∈[95,105], z∈[5,15], origin [0,0,0] so rings are already world coords.
const WALL: MapCollision = {
  version: 1, origin: [0, 0, 0],
  buildings: [{ id: 'w', minY: 0, maxY: 20, heightSource: 'test', rings: [[[95, 15], [95, 5], [105, 5], [105, 15]]] }],
};
const MANIFEST = JSON.stringify({
  version: 1, chunkSize: 256,
  chunks: [{ id: '0:0', x: 0, z: 0, collision: { path: 'chunks/0_0/collision.bin' } }],
});

describe('mergeChunks', () => {
  it('rebases each chunk\'s origin-relative rings into one world-frame collision', () => {
    const a: MapCollision = { version: 1, origin: [1000, 0, 2000], buildings: [{ id: 'a', minY: 0, maxY: 10, heightSource: 't', rings: [[[1, 2], [3, 4]]] }] };
    const merged = mergeChunks([a]);
    expect(merged.origin).toEqual([0, 0, 0]);
    expect(merged.buildings[0]!.rings[0]).toEqual([[1001, 2002], [1003, 2004]]);
  });
});

describe('CombatCollision', () => {
  it('returns undefined until the point\'s own chunk is loaded, then a merged collision', async () => {
    const c = new CombatCollision(mockAssets({ 'map/sf/manifest.json': utf8(MANIFEST), 'chunks/0_0/collision.bin': collisionBin(WALL) }), 'map/sf/manifest.json');
    expect(c.near(10, 10)).toBeUndefined();      // cold: nothing loaded
    await c.warm(10, 10);                         // loads chunk 0:0 (+ absent neighbours → null)
    const near = c.near(10, 10);
    expect(near).toBeDefined();
    expect(near!.buildings.length).toBe(1);
  });

  it('server LoS through the loaded collision blocks a shot through the wall, allows a clear one', async () => {
    const c = new CombatCollision(mockAssets({ 'map/sf/manifest.json': utf8(MANIFEST), 'chunks/0_0/collision.bin': collisionBin(WALL) }), 'map/sf/manifest.json');
    await c.warm(10, 10);
    const col = c.near(10, 10)!;
    expect(lineOfSight([10, 1.4, 10], [210, 1.4, 10], col)).toBe(false); // ray at z=10 crosses the wall
    expect(lineOfSight([10, 1.4, 100], [210, 1.4, 100], col)).toBe(true); // z=100 clear of the wall
  });

  it('gtasf-j7wvv: the parsed-chunk cache is LRU-bounded (COLLISION_CACHE_MAX); recently used chunks stay, old ones reload', async () => {
    const c = new CombatCollision(mockAssets({ 'map/sf/manifest.json': utf8(MANIFEST), 'chunks/0_0/collision.bin': collisionBin(WALL) }), 'map/sf/manifest.json');
    await c.warm(10, 10);
    expect(c.near(10, 10)).toBeDefined();
    // Roam far: 300 distant spots x a 3x3 of (absent → null) chunks each would be ~2,700 entries unbounded.
    for (let i = 1; i <= 300; i++) await c.warm(i * 2000, 0);
    const size = (c as unknown as { cache: Map<string, unknown> }).cache.size;
    expect(size).toBeLessThanOrEqual(COLLISION_CACHE_MAX);
    expect(c.near(300 * 2000, 0)).toBeDefined();   // the latest area is still cached
    expect(c.near(10, 10)).toBeUndefined();         // the first area was evicted…
    await c.warm(10, 10);
    expect(c.near(10, 10)!.buildings.length).toBe(1); // …and reloads on demand
  });

  it('gtasf-j7wvv: near() reuses the merged 3x3 between calls (no per-call re-merge) and re-merges after the chunk cache changes', async () => {
    const c = new CombatCollision(mockAssets({ 'map/sf/manifest.json': utf8(MANIFEST), 'chunks/0_0/collision.bin': collisionBin(WALL) }), 'map/sf/manifest.json');
    await c.warm(10, 10);
    const first = c.near(10, 10)!;
    expect(c.near(50, 80)).toBe(first);           // same centre chunk, same tick or the next: no new merge
    await c.warm(5000, 0);                         // another area loads → the cached merges are dropped…
    const again = c.near(10, 10)!;
    expect(again).not.toBe(first);                 // …so a merge never outlives the chunks it was built from
    expect(again.buildings.length).toBe(1);
    expect(lineOfSight([10, 1.4, 10], [210, 1.4, 10], again)).toBe(false);
  });

  it('no manifest key → never enforces (fail-safe)', async () => {
    const c = new CombatCollision(mockAssets({}), undefined);
    await c.warm(10, 10);
    expect(c.near(10, 10)).toBeUndefined();
  });

  it('an open area (chunk loaded, no buildings) returns an empty-buildings collision, not undefined', async () => {
    const empty: MapCollision = { version: 1, origin: [0, 0, 0], buildings: [] };
    const c = new CombatCollision(mockAssets({ 'map/sf/manifest.json': utf8(MANIFEST), 'chunks/0_0/collision.bin': collisionBin(empty) }), 'map/sf/manifest.json');
    await c.warm(10, 10);
    const near = c.near(10, 10);
    expect(near).toBeDefined();
    expect(near!.buildings.length).toBe(0);
    expect(lineOfSight([10, 1.4, 10], [210, 1.4, 10], near!)).toBe(true); // nothing to block
  });
});

describe('CombatCollision — the PUBLISHED manifest format (prod)', () => {
  // Prod manifests carry absolute URL paths and JSON chunk files; R2 keys have no leading slash.
  const PROD_MANIFEST = JSON.stringify({
    version: 1, chunkSize: 256,
    chunks: [{ id: '0_0', x: 0, z: 0, collision: { path: '/map/releases/abc/chunks/0_0/collision.json', bytes: 1, gzipBytes: 1, sha256: 'x' } }],
  });
  it('loads a leading-slash JSON chunk, so line of sight actually sees the wall', async () => {
    const c = new CombatCollision(mockAssets({
      'map/sf/manifest.json': utf8(PROD_MANIFEST),
      'map/releases/abc/chunks/0_0/collision.json': utf8(JSON.stringify(WALL)),
    }), 'map/sf/manifest.json');
    await c.warm(100, 0);
    const near = c.near(100, 0);
    expect(near?.buildings).toHaveLength(1);
    expect(lineOfSight([100, 1.4, 0], [100, 1.4, 30], near!)).toBe(false); // through the wall
  });
});

describe('CombatCollision — load races and transient failures (fail closed)', () => {
  const PROD_MANIFEST = JSON.stringify({
    version: 1, chunkSize: 256,
    chunks: [{ id: '0_0', x: 0, z: 0, collision: { path: '/map/releases/abc/chunks/0_0/collision.json', bytes: 1, gzipBytes: 1, sha256: 'x' } }],
  });
  const files = { 'map/sf/manifest.json': utf8(PROD_MANIFEST), 'map/releases/abc/chunks/0_0/collision.json': utf8(JSON.stringify(WALL)) };
  /** An R2 mock where every get takes `delayMs`, and the first `failFirst` gets of `failKey` throw. */
  function slowAssets(delayMs: number, failKey?: string, failFirst = 0): R2Bucket {
    let fails = 0;
    return { get: async (key: string) => {
      await new Promise(r => setTimeout(r, delayMs));
      if (key === failKey && fails++ < failFirst) throw new Error('R2 hiccup');
      const f = (files as Record<string, ArrayBuffer>)[key];
      return f ? { httpMetadata: {}, arrayBuffer: async () => f } : null;
    } } as unknown as R2Bucket;
  }

  it('two concurrent warm()s during a slow (20 ms) manifest fetch: buildings present, LoS blocked', async () => {
    const c = new CombatCollision(slowAssets(20), 'map/sf/manifest.json');
    await Promise.all([c.warm(100, 0), c.warm(100, 0)]);
    expect(c.status).toBe('loaded');
    const near = c.near(100, 0);
    expect(near?.buildings).toHaveLength(1);
    expect(lineOfSight([100, 1.4, 0], [100, 1.4, 30], near!)).toBe(false);
  });

  it('while the manifest is still loading, near() is undefined and status unknown (callers fail closed)', async () => {
    const c = new CombatCollision(slowAssets(20), 'map/sf/manifest.json');
    const pending = c.warm(100, 0);
    expect(c.status).toBe('unknown');
    expect(c.near(100, 0)).toBeUndefined();
    await pending;
    expect(c.near(100, 0)?.buildings).toHaveLength(1);
  });

  it('a transient manifest error does not latch "no collision": it retries after backoff and loads', async () => {
    let t = 0;
    const c = new CombatCollision(slowAssets(0, 'map/sf/manifest.json', 1), 'map/sf/manifest.json', () => t);
    await c.warm(100, 0);
    expect(c.status).toBe('unknown');
    expect(c.near(100, 0)).toBeUndefined();
    t += 1_500; // past the first backoff
    await c.warm(100, 0);
    expect(c.status).toBe('loaded');
    expect(c.near(100, 0)?.buildings).toHaveLength(1);
  });

  it('a transient chunk error is NOT cached as empty: near() stays closed, then the retry loads the wall', async () => {
    let t = 0;
    const c = new CombatCollision(slowAssets(0, 'map/releases/abc/chunks/0_0/collision.json', 1), 'map/sf/manifest.json', () => t);
    await c.warm(100, 0);
    expect(c.near(100, 0)).toBeUndefined(); // not "no buildings"
    t += 1_500;
    await c.warm(100, 0);
    expect(c.near(100, 0)?.buildings).toHaveLength(1);
  });

  it('a world with no manifest is KNOWN to have none (status none)', async () => {
    const c = new CombatCollision(slowAssets(0), 'map/missing/manifest.json');
    await c.warm(0, 0);
    expect(c.status).toBe('none');
  });
});

// serverTerrainLos (gtasf-fajmy): chunk 0:0's drawn ground — 5x5 GTHF samples 64 m apart, flat at 0 except a 30 m ridge
// along x = 128 — loads with its collision, and shot/police LoS over the ridge is blocked.
function gthf(size: number, step: number, cx: number, cz: number, heightCm: (i: number, j: number) => number): ArrayBuffer {
  const buffer = new ArrayBuffer(32 + size * size * 2), v = new DataView(buffer);
  v.setUint32(0, 0x47544846, false); v.setUint16(4, 1, true); v.setUint16(6, size, true); v.setFloat32(8, step, true);
  v.setInt32(12, 0, true); v.setInt32(16, cx, true); v.setInt32(20, cz, true); v.setFloat32(24, .01, true);
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) v.setUint16(32 + (j * size + i) * 2, heightCm(i, j), true);
  return buffer;
}
describe('CombatCollision terrain (serverTerrainLos)', () => {
  const OPEN: MapCollision = { version: 1, origin: [0, 0, 0], buildings: [] };
  const TERRAIN_MANIFEST = JSON.stringify({ version: 1, chunkSize: 256,
    chunks: [{ id: '0:0', x: 0, z: 0, collision: { path: 'chunks/0_0/collision.bin' }, terrain: { path: 'chunks/0_0/terrain.bin' } }] });
  const files = () => ({ 'map/sf/manifest.json': utf8(TERRAIN_MANIFEST), 'chunks/0_0/collision.bin': collisionBin(OPEN),
    'chunks/0_0/terrain.bin': gthf(5, 64, 0, 0, i => (i === 2 ? 3000 : 0)) });
  async function withTerrain<T>(run: () => Promise<T>): Promise<T> {
    const { flags } = await import('@gtasf/shared/flags');
    const before = flags.serverTerrainLos; (flags as Record<string, boolean>).serverTerrainLos = true;
    try { return await run(); } finally { (flags as Record<string, boolean>).serverTerrainLos = before; }
  }
  it('loads each chunk\'s drawn ground with its collision and samples it', async () => withTerrain(async () => {
    const c = new CombatCollision(mockAssets(files()), 'map/sf/manifest.json');
    expect(c.heightAt(128, 100)).toBeNull(); // cold
    await c.warm(100, 100);
    expect(c.heightAt(128, 100)).toBeCloseTo(30);
    expect(c.heightAt(10, 100)).toBeCloseTo(0);
    expect(c.heightAt(400, 100)).toBeNull(); // a chunk with no terrain loaded doesn't block
  }));
  it('blocks a shot over the ridge, clears the same shot on flat ground', async () => withTerrain(async () => {
    const c = new CombatCollision(mockAssets(files()), 'map/sf/manifest.json');
    await c.warm(100, 100);
    const collision = c.near(100, 100)!, heightAt = (x: number, z: number) => c.heightAt(x, z);
    expect(policeLineClear(collision, [30, 1.5, 100], [220, 1.5, 100], heightAt)).toBe(false); // through the ridge
    expect(policeLineClear(collision, [30, 1.5, 100], [220, 1.5, 100])).toBe(true);             // old behaviour: buildings only
    expect(policeLineClear(collision, [5, 1.5, 100], [50, 1.5, 100], heightAt)).toBe(true);     // flat ground
  }));
  it('a tunnel (both ends under the drawn ground) falls back to buildings only — police can still fire and bust there', async () => withTerrain(async () => {
    const c = new CombatCollision(mockAssets(files()), 'map/sf/manifest.json');
    await c.warm(100, 100);
    const collision = c.near(100, 100)!, heightAt = (x: number, z: number) => c.heightAt(x, z);
    expect(policeLineClear(collision, [120, 1.5, 100], [136, 1.5, 100], heightAt)).toBe(true); // inside the ridge: a bore
    expect(policeLineClear(collision, [30, 1.5, 100], [128, 1.5, 100], heightAt)).toBe(true);  // target in the bore: skip too
  }));
  it('leaves terrain unloaded when the flag is off', async () => {
    const c = new CombatCollision(mockAssets(files()), 'map/sf/manifest.json');
    await c.warm(100, 100);
    expect(c.heightAt(128, 100)).toBeNull();
  });
});
