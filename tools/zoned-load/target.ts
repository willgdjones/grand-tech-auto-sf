/**
 * Pure safety + topology helpers for the zoned-world staging load driver (docs/engineering/zoned-world.md §13).
 *
 * The driver opens thousands of real WebSocket connections, so the single most important rule — from the
 * founder brief, "never load-test production" — is enforced here as a pure, unit-tested gate:
 * `assertStagingTarget` refuses any URL that looks like the production worker or Pages site, refuses a
 * missing/malformed URL, and normalises http(s) to ws(s). The driver cannot connect until this returns.
 */
import { zoneView, type Cell, type ZoneGrid } from '@gtasf/shared/world/zones';

/** Hostname fragments that identify GTASF production. A staging host must contain none of them. */
export const PRODUCTION_HOST_MARKERS = Object.freeze([
  'gtasf-production', // the production Worker (name in worker/wrangler.production.jsonc, served on *.workers.dev)
  'gtasf.pages.dev',  // the production web Pages site (artifacts/production/last-deploy.json)
]);

export interface LoadTarget {
  /** ws:// or wss:// origin the bots dial, e.g. wss://gtasf-staging.example.workers.dev */
  readonly wsOrigin: string;
  /** http:// or https:// origin for any REST probes (admission, metrics). */
  readonly httpOrigin: string;
  readonly hostname: string;
  readonly secure: boolean;
}

/**
 * Validate and normalise a load-test target URL. Throws (never returns) for anything that is missing,
 * malformed, the wrong scheme, or a production host. `extraMarkers` lets an operator block additional
 * hosts (e.g. a custom prod domain) via env without editing code.
 */
export function assertStagingTarget(rawUrl: string | undefined, extraMarkers: readonly string[] = []): LoadTarget {
  if (!rawUrl || !rawUrl.trim()) {
    throw new Error('No target URL. Set GTASF_ZONED_STAGING_URL to the staging wss:// origin (never production).');
  }
  let url: URL;
  try { url = new URL(rawUrl.trim()); } catch { throw new Error(`Malformed target URL: ${rawUrl}`); }
  const scheme = url.protocol.replace(':', '');
  if (!['ws', 'wss', 'http', 'https'].includes(scheme)) {
    throw new Error(`Target must be ws/wss/http/https, got "${url.protocol}".`);
  }
  const host = url.hostname.toLowerCase();
  if (url.username || url.password) throw new Error('Target credentials are not allowed in the URL.');
  if (host === 'gtasf.com' || (host.endsWith('.gtasf.com') && host !== 'staging.gtasf.com'))
    throw new Error('Refusing to load-test a PRODUCTION GTASF domain. Use staging.gtasf.com.');
  const markers = [...PRODUCTION_HOST_MARKERS, ...extraMarkers.map(m => m.toLowerCase()).filter(Boolean)];
  const hit = markers.find(m => host.includes(m));
  if (hit) throw new Error(`Refusing to load-test a PRODUCTION host (matched "${hit}"): ${url.hostname}. Use a staging deploy.`);
  const secure = scheme === 'wss' || scheme === 'https';
  const authority = url.host; // hostname[:port]
  return { wsOrigin: `${secure ? 'wss' : 'ws'}://${authority}`, httpOrigin: `${secure ? 'https' : 'http'}://${authority}`, hostname: url.hostname, secure };
}

/** A staging-looking hostname is insufficient: check the deployed environment and actual flags. */
export function assertStagingHealth(value: unknown): void {
  const h = value as { ok?: unknown; environment?: unknown; flags?: Record<string, unknown> } | null;
  if (!h || h.ok !== true || h.environment !== 'staging') throw new Error('Target did not prove ENVIRONMENT=staging.');
  if (!h.flags?.multiplayer || !h.flags.zonedWorld || !h.flags.deepLinkSpawns || h.flags.worldCapacity)
    throw new Error('Staging requires multiplayer, zonedWorld and deepLinkSpawns on, worldCapacity off.');
}

/**
 * The neighbour cells a bot at world position (xCm, zCm) in centimetres should open read-only observer
 * sockets to — i.e. zoneView().observers, matching the real client (web/src/net/zoneObservers.ts). A bot
 * deep inside a cell returns []; one within BORDER_SUBSCRIBE_M of a border returns the adjacent cell(s).
 */
export function observerCellsFor(xCm: number, zCm: number, grid: ZoneGrid): Cell[] {
  return [...zoneView(grid, xCm / 100, zCm / 100).observers];
}
