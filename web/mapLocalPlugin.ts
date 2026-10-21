import { createReadStream, existsSync, readFileSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Connect, Plugin } from 'vite';

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

function quality(header: string, encoding: string): number {
  const values = new Map(header.toLowerCase().split(',').filter(Boolean).map(entry => {
    const [name = '', ...parameters] = entry.trim().split(';');
    const q = parameters.map(p => p.trim()).find(p => p.startsWith('q='));
    const value = q === undefined ? 1 : Number(q.slice(2));
    return [name.trim(), Number.isFinite(value) && value >= 0 && value <= 1 ? value : 0];
  }));
  return values.get(encoding) ?? (encoding === 'identity' ? (values.get('*') === 0 ? 0 : 1) : values.get('*') ?? 0);
}

/** Same middleware in dev, preview and the HTTP transfer checks. */
export function createLocalMapMiddleware(root: string): Connect.NextHandleFunction {
  const verified = new Map<string, { stamp: string; valid: Promise<boolean> }>();
  async function validBrotli(path: string): Promise<boolean> {
    try {
      const paths = [path, `${path}.br`, `${path}.br.json`];
      const info = await Promise.all(paths.map(p => stat(p)));
      if (info.some(s => !s.isFile())) return false;
      const stamp = info.map(s => `${s.ino}:${s.size}:${s.mtimeMs}:${s.ctimeMs}`).join('|');
      const cached = verified.get(path);
      if (cached?.stamp === stamp) return cached.valid;
      const valid = (async () => {
        const [raw, encoded, metadata] = await Promise.all(paths.map(p => readFile(p)));
        const receipt = JSON.parse(metadata!.toString('utf8')) as Record<string, unknown>;
        return receipt.version === 1 && receipt.bytes === raw!.length && receipt.brotliBytes === encoded!.length
          && receipt.sha256 === sha256(raw!) && receipt.brotliSha256 === sha256(encoded!);
      })().catch(() => false);
      verified.set(path, { stamp, valid });
      return valid;
    } catch { return false; }
  }
  return async (request, response, next) => {
    if (!request.url?.startsWith('/map/lombard/')) return next();
    let path: string;
    try {
      const relative = decodeURIComponent(request.url.split('?')[0]!.slice('/map/lombard/'.length));
      path = resolve(root, relative);
      if (!path.startsWith(resolve(root) + sep) || !/\.(?:json|bin|glb)$/.test(path)) {
        response.writeHead(403).end(); return;
      }
    } catch { response.writeHead(400).end(); return; }
    try {
      if (!(await stat(path)).isFile()) throw new Error('Not a map file');
      const header = request.headers['accept-encoding'] ?? '';
      const candidates = ['br', 'gzip', 'identity'].map(encoding => ({ encoding, q: quality(header, encoding) }))
        .filter(candidate => candidate.q > 0).sort((a, b) => b.q - a.q);
      let encoding: string | undefined;
      for (const candidate of candidates) {
        if (candidate.encoding === 'br' ? await validBrotli(path)
          : candidate.encoding === 'gzip' ? existsSync(`${path}.gz`) : true) {
          encoding = candidate.encoding; break;
        }
      }
      response.setHeader('Vary', 'Accept-Encoding');
      if (!encoding) { response.writeHead(406).end(); return; }
      const payload = encoding === 'identity' ? path : `${path}.${encoding === 'gzip' ? 'gz' : 'br'}`;
      const info = await stat(payload);
      response.setHeader('Content-Type', path.endsWith('.json') ? 'application/json' : path.endsWith('.glb') ? 'model/gltf-binary' : 'application/octet-stream');
      response.setHeader('Content-Length', info.size);
      response.setHeader('Cache-Control', 'no-cache');
      if (encoding !== 'identity') response.setHeader('Content-Encoding', encoding);
      if (request.method === 'HEAD') response.end();
      else createReadStream(payload).on('error', () => response.destroy()).pipe(response);
    } catch {
      response.writeHead(404, { 'Content-Type': 'text/plain' }).end('Local map missing. Build the selected map with the map pipeline.');
    }
  };
}

/** Prefer the authored city districts to the old sparse city bake when they share routing.
 * Explicit GTASF_MAP_AREA always wins, including intentional inspection of the legacy sf bake.
 * This changes only local serving: no activation file, bake or production asset is written.
 */
function populatedCityArea(output: string, area: string): string {
  if (area !== 'sf') return area;
  const candidate = 'district-tm7m-seams-meshopt';
  interface Manifest {
    version: number; frame: unknown; axes: unknown; bounds: unknown; chunkSize: number;
    roadGraph: { path: string; sha256: string };
    chunks: { lods: { path: string }[]; terrain: { path: string }; collision: { path: string } }[];
  }
  try {
    const read = (name: string) => JSON.parse(readFileSync(resolve(output, name, 'manifest.json'), 'utf8')) as Manifest;
    const current = read(area), next = read(candidate);
    if (!/^[a-f0-9]{64}$/.test(next.roadGraph.sha256) || next.roadGraph.sha256 !== current.roadGraph.sha256
      || next.version !== current.version || next.chunkSize !== current.chunkSize
      || (['frame', 'axes', 'bounds'] as const).some(key => JSON.stringify(next[key]) !== JSON.stringify(current[key]))) return area;
    // A half-written/removed bake must never replace the usable baseline. Check all streamed files.
    const paths = [next.roadGraph.path, ...next.chunks.flatMap(chunk =>
      [...chunk.lods.map(lod => lod.path), chunk.terrain.path, chunk.collision.path])];
    if (!next.chunks.length || !paths.every(path => typeof path === 'string' && existsSync(resolve(output, candidate, path)))) return area;
    return candidate;
  } catch { return area; }
}

/** Serve the generated map in dev/preview without copying megabytes into web/public. */
export function localMapPlugin(): Plugin {
  const output = fileURLToPath(new URL('../tools/map/out/', import.meta.url));
  let area = process.env.GTASF_MAP_AREA;
  if (!area && existsSync(resolve(output, 'active-map.json'))) {
    area = (JSON.parse(readFileSync(resolve(output, 'active-map.json'), 'utf8')) as { area: string }).area;
  }
  area ??= 'lombard';
  if (!process.env.GTASF_MAP_AREA) area = populatedCityArea(output, area);
  if (!/^[a-z0-9_-]+$/.test(area)) throw new Error('Invalid GTASF_MAP_AREA');
  // Resolve once per dev/preview server so an activation cannot mix two bakes.
  // Keep the public URL stable for existing radar, props and cinematic consumers.
  const root = resolve(output, area);
  const middleware = createLocalMapMiddleware(root);
  const serve = (server: { middlewares: { use: (handler: Connect.NextHandleFunction) => unknown } }) => {
    console.info(`GTASF local map: ${area} (override with GTASF_MAP_AREA)`);
    server.middlewares.use(middleware);
  };
  return { name: 'gtasf-local-map', configureServer: serve, configurePreviewServer: serve };
}
