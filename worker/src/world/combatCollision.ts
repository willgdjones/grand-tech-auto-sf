/**
 * GTA V pivot — LANE B (combat & police): server-side building collision for line-of-sight (flag serverHits).
 *
 * The WorldDO has no building collision (it only loads the road graph; collision is per-chunk, streamed to the
 * client to stay under the download budget). To validate hits server-authoritatively — so a client can't shoot
 * a player through a wall — this lazily fetches the per-chunk rings-v1 collision.bin from R2 for chunks AROUND
 * active combat, caches them, and merges the few chunks a shot can cross into one world-frame MapCollision for
 * rayVsWorld/lineOfSight.
 *
 * Async fetch vs. a synchronous fire(): `warm()` pre-loads the 3×3 chunks around a firing/wanted player, and
 * `near()` returns undefined (⇒ don't enforce LoS this shot) until the shooter's own chunk is loaded, so a cold
 * first shot never shoots-through, and "no walls here" is an empty-buildings collision, not a skipped check.
 */
import { decodeMapCollision, type MapCollision } from '@gtasf/shared/mapCollision';
import { lineOfSight } from '@gtasf/shared/combat/rayVsWorld';
import { restoreMapArtifact, type TransportMetadata } from '@gtasf/shared/mapTransport';
import { flags } from '@gtasf/shared/flags';
import { decodeHeightfield, sampleDrawnHeight, type Heightfield } from '@gtasf/shared/map/heightfield';

export const COLLISION_CHUNK_M = 256;
const CHUNK_M = COLLISION_CHUNK_M;

/**
 * Line of sight for SFPD actions — return fire and every off-road step by a cruiser or officer. Fails CLOSED: with no
 * loaded collision there is no way to know a wall isn't in the way, so the shot / step is BLOCKED (police hold fire and
 * stay put rather than shooting or walking through a building). Player shots keep their own (first-shot) policy.
 */
type Vec3 = readonly [number, number, number];
type HeightAt = (x: number, z: number) => number | null;
/** serverTerrainLos (reviewer 2108e126): the terrain test for one line. Skipped when either end is more than 0.5 m under
 *  the drawn ground — a tunnel bore (Broadway, Stockton, Presidio): terrain.bin is the hill ABOVE it, so every line inside
 *  would hit at once and a wanted player there could never be shot or busted; buildings-only there, as before. A 0.25 m
 *  tolerance keeps lines that skim a crest (clear on screen) clear. */
export function terrainLos(heightAt: HeightAt | undefined, from: Vec3, to: Vec3): { heightAt?: HeightAt } {
  if (!heightAt) return {};
  const under = (p: Vec3) => { const g = heightAt(p[0], p[2]); return g !== null && p[1] < g - .5; };
  if (under(from) || under(to)) return {};
  return { heightAt: (x, z) => { const g = heightAt(x, z); return g === null ? null : g - .25; } };
}
export function policeLineClear(collision: MapCollision | undefined, from: Vec3, to: Vec3, heightAt?: HeightAt): boolean {
  return collision !== undefined && lineOfSight(from, to, collision, terrainLos(heightAt, from, to));
}

interface ChunkInfo { x: number; z: number; collision: TransportMetadata & { path: string }; terrain?: TransportMetadata & { path: string } }

async function readBytes(object: R2ObjectBody): Promise<ArrayBuffer> {
  return object.httpMetadata?.contentEncoding === 'gzip'
    ? new Response(object.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer()
    : object.arrayBuffer();
}

/** Merge chunk collisions into one world-frame MapCollision (origin [0,0,0]; rings in absolute world metres). */
export function mergeChunks(collisions: readonly MapCollision[]): MapCollision {
  const buildings: MapCollision['buildings'] = [];
  for (const c of collisions) {
    const ox = c.origin[0], oz = c.origin[2];
    for (const b of c.buildings) {
      buildings.push({ ...b, rings: b.rings.map(ring => ring.map(([rx, rz]) => [rx + ox, rz + oz] as [number, number])) });
    }
  }
  return { version: 1, origin: [0, 0, 0], buildings };
}

/** A chunk collision as the client reads it: undo any compact transport (restoreMapArtifact), then JSON (the published
 *  'collision.json' rings), falling back to the bare compact rings-v1 binary. */
export async function parseCollision(buffer: ArrayBuffer, metadata: TransportMetadata): Promise<MapCollision> {
  const bytes = new Uint8Array(await restoreMapArtifact(buffer, metadata, 'collision', flags.compactMapAssets));
  if (bytes[0] === 0x7b /* '{' */) {
    const value = JSON.parse(new TextDecoder().decode(bytes)) as MapCollision;
    if (value?.version !== 1 || !Array.isArray(value.origin) || !Array.isArray(value.buildings)) throw new Error('COLLISION_JSON');
    return value;
  }
  return decodeMapCollision(bytes);
}

/** Whether this world's collision data is known: still loading/retrying, absent (local/dev), or loaded (prod). */
export type CollisionStatus = 'unknown' | 'none' | 'loaded';

/**
 * Whether a PLAYER shot's line of sight can be judged: the shooter's collision is loaded, or this world is known to
 * have NO collision data (local/dev without a published map — keep shots working). While the manifest is still loading
 * or retrying ('unknown'), or a chunk isn't loaded yet, the shot must not harm anyone (fail closed).
 */
export function shotLosKnown(collision: MapCollision | undefined, status: CollisionStatus): boolean {
  return collision !== undefined || status === 'none';
}

const RETRY_MIN_MS = 1_000, RETRY_MAX_MS = 60_000;
/** gtasf-j7wvv: parsed chunks kept per world DO. The cache used to be unbounded: every chunk any player ever approached stayed
 *  in the single 'sf' DO (up to all 2,501 city chunks, tens of MB parsed) while the DO also holds the 23 MB road graph. LRU:
 *  chunks near active players are refreshed by near(), the rest are evicted and reload on demand. */
export const COLLISION_CACHE_MAX = 512;
const MERGED_CACHE_MAX = 16;

export class CombatCollision {
  private readonly grid = new Map<string, ChunkInfo>();
  private state: CollisionStatus = 'unknown';
  private manifestPromise: Promise<void> | undefined;      // ONE in-flight manifest load every warm() awaits
  private manifestRetryAt = 0;
  private manifestBackoff = RETRY_MIN_MS;
  // key → collision; null ONLY for a chunk absent from the LOADED grid (genuinely nothing to occlude).
  private readonly cache = new Map<string, MapCollision | null>(); // LRU by insertion order (see remember/near)
  private readonly loading = new Map<string, Promise<void>>();
  private readonly chunkRetry = new Map<string, { at: number; backoff: number }>(); // transient failures: retry later
  // gtasf-j7wvv: merged 3x3 collision per centre chunk. near() runs per police unit per tick (sight, off-road steps,
  // busts, fire) plus per player shot; re-merging every call copied every ring point of 9 chunks (2.3 ms and ~0.3 MB
  // of garbage per call downtown), i.e. tens of ms of CPU and MB/s of GC per tick while anyone was wanted. Any chunk
  // insert/eviction clears it, so a cached merge is always exactly the current 9 chunks.
  private readonly merged = new Map<string, MapCollision>();
  // serverTerrainLos (gtasf-fajmy): each chunk's drawn ground (GTHF terrain.bin: 9x9 coarse, 65x65 detailed, < 9 KB), loaded
  // with its collision and evicted with it, so shot LoS can't pass through hills. Missing/failed terrain = no terrain test.
  // Numeric keys + a last-field cache: heightAt runs per 1 m raymarch sample (reviewer 2108e126: no string key per sample).
  private readonly terrain = new Map<number, Heightfield>();
  private lastTerrainKey = NaN; private lastTerrain: Heightfield | undefined;
  private terrainKey(gx: number, gz: number): number { return (gx + 32768) * 65536 + (gz + 32768); }

  constructor(private readonly assets: R2Bucket, private readonly manifestKey: string | undefined,
    private readonly now: () => number = Date.now) {}

  /** 'loaded' once a published manifest with chunk collision is in; 'none' for a world with no collision data. */
  get status(): CollisionStatus { return this.state; }

  private key(gx: number, gz: number): string { return `${gx}:${gz}`; }

  private loadManifest(): Promise<void> {
    if (this.state !== 'unknown') return Promise.resolve();
    if (this.manifestPromise) return this.manifestPromise;
    if (this.now() < this.manifestRetryAt) return Promise.resolve(); // backing off after a failure (stays unknown)
    this.manifestPromise = (async () => {
      try {
        if (!this.manifestKey || !/manifest\.json$/.test(this.manifestKey)) { this.state = 'none'; return; }
        const object = await this.assets.get(this.manifestKey);
        if (!object) { this.state = 'none'; return; } // no published map in this world (local/dev)
        const m = JSON.parse(new TextDecoder().decode(await readBytes(object))) as { chunkSize?: number; chunks?: ChunkInfo[] };
        if (m.chunkSize !== CHUNK_M || !Array.isArray(m.chunks)) { this.state = 'none'; return; }
        for (const c of m.chunks) if (c?.collision?.path) this.grid.set(this.key(c.x, c.z), { x: c.x, z: c.z, collision: c.collision, ...(c.terrain?.path ? { terrain: c.terrain } : {}) });
        this.state = this.grid.size ? 'loaded' : 'none';
      } catch {
        // Transient R2/parse failure: stay 'unknown' (fail closed) and retry with backoff — never latch "no collision".
        this.grid.clear();
        this.manifestRetryAt = this.now() + this.manifestBackoff;
        this.manifestBackoff = Math.min(RETRY_MAX_MS, this.manifestBackoff * 2);
      } finally {
        this.manifestPromise = undefined;
      }
    })();
    return this.manifestPromise;
  }

  private loadChunk(key: string): Promise<void> {
    if (this.state !== 'loaded' || this.cache.has(key)) return Promise.resolve();
    const inFlight = this.loading.get(key);
    if (inFlight) return inFlight;
    const retry = this.chunkRetry.get(key);
    if (retry && this.now() < retry.at) return Promise.resolve();
    const info = this.grid.get(key);
    if (!info) { this.remember(key, null); return Promise.resolve(); } // absent from the loaded grid → nothing to occlude
    const work = (async () => {
      try {
        // Published manifests give absolute URL paths ('/map/releases/<sha>/chunks/x_z/collision.json'); R2 keys have
        // no leading slash (same as the /map route and worldRoads).
        const r2Key = info.collision.path.replace(/^\//, '');
        if (!r2Key || r2Key.includes('..')) throw new Error('COLLISION_PATH');
        const object = await this.assets.get(r2Key);
        if (!object) throw new Error('COLLISION_MISSING'); // listed but missing: treat as transient, retry
        const terrain = flags.serverTerrainLos && info.terrain ? await this.loadTerrain(info.terrain).catch(error => {
          // Fails open for this chunk (collision still guards) until it's evicted and reloaded.
          console.warn('combat terrain load failed', key, error instanceof Error ? error.message : 'unknown'); return undefined;
        }) : undefined;
        this.remember(key, await parseCollision(await readBytes(object), info.collision));
        if (terrain) { this.terrain.set(this.terrainKey(info.x, info.z), terrain); this.lastTerrainKey = NaN; }
        this.chunkRetry.delete(key);
      } catch {
        const backoff = Math.min(RETRY_MAX_MS, (retry?.backoff ?? RETRY_MIN_MS / 2) * 2);
        this.chunkRetry.set(key, { at: this.now() + backoff, backoff }); // not cached: near() stays undefined (closed)
      } finally {
        this.loading.delete(key);
      }
    })();
    this.loading.set(key, work);
    return work;
  }
  private async loadTerrain(info: TransportMetadata & { path: string }): Promise<Heightfield> {
    const r2Key = info.path.replace(/^\//, '');
    if (!r2Key || r2Key.includes('..')) throw new Error('TERRAIN_PATH');
    const object = await this.assets.get(r2Key);
    if (!object) throw new Error('TERRAIN_MISSING');
    return decodeHeightfield(await restoreMapArtifact(await readBytes(object), info, 'height', flags.compactMapAssets));
  }
  /** Insert as most-recent and evict the least-recently used chunks beyond COLLISION_CACHE_MAX. */
  private remember(key: string, value: MapCollision | null): void {
    this.cache.delete(key); this.cache.set(key, value); this.merged.clear();
    while (this.cache.size > COLLISION_CACHE_MAX) {
      const oldest = this.cache.keys().next().value; if (oldest === undefined) break; this.cache.delete(oldest);
      const [gx, gz] = oldest.split(':').map(Number); this.terrain.delete(this.terrainKey(gx!, gz!)); this.lastTerrainKey = NaN;
    }
  }
  /** serverTerrainLos: the drawn ground height (m) at a world point, or null when its chunk's terrain isn't loaded. */
  heightAt(xMetres: number, zMetres: number): number | null {
    const key = this.terrainKey(Math.floor(xMetres / CHUNK_M), Math.floor(zMetres / CHUNK_M));
    if (key !== this.lastTerrainKey) { this.lastTerrainKey = key; this.lastTerrain = this.terrain.get(key); }
    return this.lastTerrain ? sampleDrawnHeight(this.lastTerrain, xMetres, zMetres) : null;
  }

  /** Pre-load the 3×3 chunks around a point so later shots there can be LoS-validated. Concurrent callers share the
   *  same manifest + chunk loads. */
  warm(xMetres: number, zMetres: number): Promise<void> {
    return (async () => {
      await this.loadManifest();
      if (this.state !== 'loaded') return;
      const cx = Math.floor(xMetres / CHUNK_M), cz = Math.floor(zMetres / CHUNK_M);
      const loads: Promise<void>[] = [];
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) loads.push(this.loadChunk(this.key(cx + dx, cz + dz)));
      await Promise.all(loads);
    })();
  }

  /**
   * Merged world-frame collision for the 3×3 chunks around a point — only when the manifest is loaded and EVERY one of
   * those chunks is cached (a partial set could miss a wall in a neighbour chunk). undefined otherwise ⇒ callers fail
   * closed (police) or harm no one (player shots); see shotLosKnown for the no-data world.
   */
  near(xMetres: number, zMetres: number): MapCollision | undefined {
    if (this.state !== 'loaded') return undefined;
    const cx = Math.floor(xMetres / CHUNK_M), cz = Math.floor(zMetres / CHUNK_M);
    const loaded: MapCollision[] = [];
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      const key = this.key(cx + dx, cz + dz);
      if (!this.cache.has(key)) return undefined;
      const c = this.cache.get(key);
      if (c) loaded.push(c);
    }
    // Mark the 3x3 as recently used (Map insertion order is the LRU order).
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) { const key = this.key(cx + dx, cz + dz), c = this.cache.get(key); this.cache.delete(key); this.cache.set(key, c ?? null); }
    const centre = this.key(cx, cz);
    let merged = this.merged.get(centre);
    if (!merged) {
      merged = mergeChunks(loaded);
      this.merged.set(centre, merged);
      if (this.merged.size > MERGED_CACHE_MAX) this.merged.delete(this.merged.keys().next().value!); // a handful of active areas
    } else { this.merged.delete(centre); this.merged.set(centre, merged); }
    return merged;
  }
}
