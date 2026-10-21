import { SF_ZONE_GRID, inGrid, type Cell } from '@gtasf/shared/world/zones';
import { isChildZone, splitZoneMask, validSplitMask, zoneIsSplit, ZONE_SPLIT_POPULATION } from '@gtasf/shared/world/topology';
import type { Env } from '../env';
import { admissionJson, smallJson } from './admission/http';

const CACHE_MS = 5000;
/** Only WorldDO('sf') handles these binding-only paths. It coordinates topology, never gameplay ticks. */
export async function topologyRequest(request: Request, storage: DurableObjectStorage): Promise<Response> {
  storage.sql.exec('CREATE TABLE IF NOT EXISTS zone_topology (id INTEGER PRIMARY KEY CHECK(id=1), split_mask INTEGER NOT NULL)');
  storage.sql.exec('INSERT OR IGNORE INTO zone_topology VALUES (1,0)');
  const read = () => storage.sql.exec<{ split_mask: number }>('SELECT split_mask FROM zone_topology WHERE id=1').one().split_mask;
  if (request.method === 'POST') {
    const body = await smallJson(request);
    if (!body || !inGrid(SF_ZONE_GRID, Number(body.cx), Number(body.cy))) return admissionJson({ error: 'Invalid district' }, 400);
    storage.transactionSync(() => {
      storage.sql.exec('UPDATE zone_topology SET split_mask=? WHERE id=1', splitZoneMask(SF_ZONE_GRID, read(), { cx: Number(body.cx), cy: Number(body.cy) }));
    });
  } else if (request.method !== 'GET') return admissionJson({ error: 'GET or POST required' }, 405);
  return admissionJson({ splitMask: read() });
}

export class WorldTopology {
  mask = 0;
  private loadedAt = -Infinity;
  private pending: Promise<number> | undefined;
  private overloadedAt: number | undefined;
  private splitting = false;
  constructor(private readonly env: Pick<Env, 'WORLD'>) {}
  private async request(cell?: Cell): Promise<number> {
    const response = await this.env.WORLD.get(this.env.WORLD.idFromName('sf')).fetch('https://world.internal/internal/topology', {
      method: cell ? 'POST' : 'GET', ...(cell ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cell) } : {}),
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error('Zone topology unavailable');
    const result = await response.json<{ splitMask: unknown }>();
    if (!validSplitMask(SF_ZONE_GRID, result.splitMask)) throw new Error('Invalid zone topology');
    this.mask |= result.splitMask; this.loadedAt = Date.now();
    return this.mask;
  }
  read(now = Date.now()): Promise<number> {
    if (now - this.loadedAt < CACHE_MS) return Promise.resolve(this.mask);
    return this.pending ??= this.request().finally(() => { this.pending = undefined; });
  }
  /** Require sustained pressure. A split is spatial and monotonic; a hot child uses the fallback queue. */
  async pressure(cell: Cell, population: number, elapsedMs: number, now: number): Promise<number> {
    if (isChildZone(SF_ZONE_GRID, cell) || zoneIsSplit(SF_ZONE_GRID, this.mask, cell)) return this.mask;
    if (population < ZONE_SPLIT_POPULATION && elapsedMs < 20) { this.overloadedAt = undefined; return this.mask; }
    this.overloadedAt ??= now;
    if (now - this.overloadedAt < 10_000 || this.splitting) return this.mask;
    this.splitting = true;
    try { return await this.request(cell); }
    finally { this.splitting = false; }
  }
}

// Each Worker isolate coalesces startup/HTTP routing reads; five-second staleness only delays a
// split, and the receiving parent also refreshes before accepting a new player.
const caches = new WeakMap<object, WorldTopology>();
export function readTopology(env: Pick<Env, 'WORLD'>): Promise<number> {
  let cache = caches.get(env.WORLD);
  if (!cache) { cache = new WorldTopology(env); caches.set(env.WORLD, cache); }
  return cache.read();
}
