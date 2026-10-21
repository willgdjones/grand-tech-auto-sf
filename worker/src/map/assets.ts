import { flags } from '@gtasf/shared/flags';

// roadgraph.bin = the whole-city roadpack-v1 graph (manifest.roadGraph); publication.ts already ships it.
const asset = '(?:manifest\\.json|roadgraph\\.bin|roadgraph-near(?:-[A-Za-z0-9_-]+)?\\.bin|roadgraph(?:-playable|-local-play)?\\.json|local-play\\.json|neighbourhoods\\.json|coastline\\.json|chunks/-?\\d+_-?\\d+/(?:lod[01]\\.glb|terrain\\.bin|collision\\.json))';
const releasePath = new RegExp(`^/map/releases/[a-f0-9]{64}/${asset}$`);
const stablePath = /^\/map\/[a-z0-9-]+\/manifest\.json$/;
// gtasf-0k01: near-spawn graph published against the live map without a city re-upload (publish-near-graph.mts),
// content-addressed by its own sha256, so immutable like a release.
const nearPath = /^\/map\/near\/[a-f0-9]{64}\/roadgraph-near(?:-[A-Za-z0-9_-]+)?\.bin$/;
const aliasPath = /^\/map\/([a-z0-9-]+)\/(roadgraph(?:-playable|-local-play)?\.json|local-play\.json|neighbourhoods\.json)$/;
function accepts(value: string | null, coding: 'gzip' | 'br', wildcard = true): boolean {
  if (!value) return false;
  const entries = value.toLowerCase().split(',').map(part => part.trim().split(';').map(p=>p.trim()));
  const match = entries.find(e=>e[0]===coding) ?? (wildcard ? entries.find(e=>e[0]==='*') : undefined);
  const quality = match?.slice(1).find(p=>p.startsWith('q='));
  return Boolean(match && (quality === undefined || Number(quality.slice(2)) > 0));
}
const acceptsGzip = (value: string | null) => accepts(value, 'gzip');
// mapBrotliAssets (gtasf-7vt00): roadgraph.bin is 10.9 MB as gzip but 6.2 MB as brotli (the GLB chunks gain only ~7%, so only
// the graph gets a .br twin). Explicit 'br' only — a bare '*' keeps the gzip path every client already handles.
const BROTLI_TWINS = /\/roadgraph\.bin$/;

/** Same-origin public map only; never exposes arbitrary ASSETS keys or uploaded ads. */
export async function serveMapAsset(request: Request, bucket: R2Bucket): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  if (!path.startsWith('/map/')) return null;
  if (!flags.mapStreaming) return new Response('Map is disabled',{status:404});
  if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method not allowed',{status:405,headers:{Allow:'GET, HEAD'}});
  const alias = aliasPath.exec(path);
  if (alias) {
    const index = await bucket.get(`map/${alias[1]}/manifest.json`);
    if (!index) return new Response('Map artifact not found',{status:404});
    const body = index.httpMetadata?.contentEncoding === 'gzip' ? index.body.pipeThrough(new DecompressionStream('gzip')) : index.body;
    const manifest = await new Response(body).json<{runtime?:Record<string,{path:string}>;roadGraph?:{path:string};neighbourhoods?:{path:string}}>();
    const target = manifest.runtime?.[alias[2]!]?.path ?? (alias[2]==='roadgraph.json'?manifest.roadGraph?.path:alias[2]==='neighbourhoods.json'?manifest.neighbourhoods?.path:undefined);
    if (!target || !releasePath.test(target)) return new Response('Map artifact not found',{status:404});
    return new Response(null,{status:302,headers:{Location:target,'Cache-Control':'public, max-age=0, must-revalidate'}});
  }
  if (!releasePath.test(path) && !nearPath.test(path) && !stablePath.test(path)) return new Response('Map artifact not found',{status:404});
  const key = path.slice(1);
  if (flags.mapBrotliAssets && BROTLI_TWINS.test(path) && releasePath.test(path) && accepts(request.headers.get('Accept-Encoding'), 'br', false)) {
    const twin = request.method === 'HEAD' ? await bucket.head(`${key}.br`) : await bucket.get(`${key}.br`);
    if (twin && twin.httpMetadata?.contentEncoding === 'br') {
      const headers = new Headers({ 'X-Content-Type-Options':'nosniff', Vary:'Accept-Encoding' });
      twin.writeHttpMetadata(headers);
      headers.set('Cache-Control','public, max-age=31536000, immutable'); headers.set('Content-Encoding','br'); headers.set('ETag',twin.httpEtag);
      if (request.headers.get('If-None-Match')?.split(',').some(tag=>tag.trim()==='*'||tag.trim().replace(/^W\//,'')===twin.httpEtag.replace(/^W\//,'')))
        return new Response(null,{status:304,headers});
      headers.set('Content-Length',String(twin.size));
      if (request.method === 'HEAD') return new Response(null,{headers,encodeBody:'manual'});
      return new Response((twin as R2ObjectBody).body,{headers,encodeBody:'manual'}); // already brotli bytes: no second encoding
    }
  }
  const object = request.method === 'HEAD' ? await bucket.head(key) : await bucket.get(key);
  if (!object) return new Response('Map artifact not found',{status:404});
  const headers = new Headers({ 'X-Content-Type-Options':'nosniff', Vary:'Accept-Encoding' });
  object.writeHttpMetadata(headers);
  headers.set('Cache-Control',releasePath.test(path)||nearPath.test(path)?'public, max-age=31536000, immutable':'public, max-age=0, must-revalidate');
  const compressed = object.httpMetadata?.contentEncoding === 'gzip';
  const decompress = compressed && !acceptsGzip(request.headers.get('Accept-Encoding'));
  const etag = decompress ? `W/${object.httpEtag}` : object.httpEtag;
  headers.set('ETag',etag);
  if (decompress) headers.delete('Content-Encoding');
  else headers.set('Content-Length',String(object.size));
  if (request.headers.get('If-None-Match')?.split(',').some(tag=>tag.trim()==='*'||tag.trim().replace(/^W\//,'')===etag.replace(/^W\//,''))) {
    headers.delete('Content-Length'); return new Response(null,{status:304,headers});
  }
  if (request.method === 'HEAD') return new Response(null,{headers,encodeBody:'manual'});
  const body = (object as R2ObjectBody).body;
  // R2 already contains gzip bytes; prevent workerd from applying a second gzip layer.
  return new Response(decompress ? body.pipeThrough(new DecompressionStream('gzip')) : body,{headers,encodeBody:'manual'});
}
