import { spawn } from 'node:child_process';
import { readFile, realpath } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { brotliCompressSync, brotliDecompressSync, constants as zlibConstants, gunzipSync, gzipSync } from 'node:zlib';
import { atomicWrite, digest } from '../pipeline/sources';
import { r2Credentials, uploadToR2 } from './r2upload';
import type { Artifact, MapManifest } from '../pipeline/types';

const repo = fileURLToPath(new URL('../../../../', import.meta.url));
const validPath = /^(?:roadgraph(?:-near(?:-[A-Za-z0-9_-]+)?)?\.bin|roadgraph(?:-playable|-local-play)?\.json|local-play\.json|neighbourhoods\.json|coastline\.json|chunks\/-?\d+_-?\d+\/(?:lod[01]\.glb|terrain\.bin|collision\.json|aerial\.jpg))$/;
export interface PublishedObject {
  key: string; file: string; bytes: number; decodedBytes: number; sha256: string;
  contentType: string; contentEncoding: 'gzip' | 'br'; cacheControl: string;
  /** Set on a .br twin: the key it is an alternative encoding of (listed in the inventory, kept out of the budget totals). */
  alternativeOf?: string;
}
export interface Publication {
  version: 1; area: string; release: string; sourceManifestSha256: string;
  bytes: number; decodedBytes: number; objects: PublishedObject[];
}
const type = (path: string) => path.endsWith('.json') ? 'application/json' : path.endsWith('.glb') ? 'model/gltf-binary' : path.endsWith('.jpg') ? 'image/jpeg' : 'application/octet-stream';

/** Validates all source bytes before producing an immutable, manifest-last upload plan. */
export async function preparePublication(root: string, output?: string, alias?: string): Promise<{ publication: Publication; directory: string }> {
  root = await realpath(root);
  const original = await readFile(join(root, 'manifest.json'));
  const manifest = JSON.parse(original.toString()) as MapManifest & {runtime:Record<string,Artifact>;release:string};
  if (manifest.version !== 1 || manifest.chunkSize !== 256 || !manifest.chunks?.length || !/^[a-z0-9-]+$/.test(manifest.area)) throw new Error('Unsupported map manifest');
  const sourceManifestSha256 = digest(original);
  // These runtime consumers predate manifest references; pin them into the published release too.
  const runtime: Record<string,Artifact> = {}, runtimeGzip = new Map<string,Buffer>();
  for (const path of ['roadgraph-playable.json','roadgraph-local-play.json','local-play.json']) {
    const file = await realpath(join(root,path));
    if (!file.startsWith(root+sep)) throw new Error('Runtime map artifact escapes output directory');
    const raw = await readFile(file), json = JSON.parse(raw.toString()) as {version?:number;nodes?:unknown[];edges?:unknown[]};
    if (json.version !== 1 || (path.startsWith('roadgraph') && (!json.nodes?.length || !json.edges?.length))) throw new Error(`Invalid runtime map artifact: ${path}`);
    const compressed = gzipSync(raw,{level:9}); runtimeGzip.set(path,compressed);
    runtime[path] = {path,bytes:raw.length,gzipBytes:compressed.length,sha256:digest(raw)};
  }
  const release = digest(Buffer.concat([original,Buffer.from(JSON.stringify(runtime))])), prefix = `map/releases/${release}`;
  manifest.runtime = runtime; manifest.release = release;
  const directory = resolve(output ?? join(dirname(root), `publication-${manifest.area}`));
  const references: Artifact[] = [manifest.roadGraph, ...(manifest.roadGraphNear ? [manifest.roadGraphNear, ...(manifest.roadGraphNear.parts ?? [])] : []), ...Object.values(runtime), ...(manifest.neighbourhoods ? [manifest.neighbourhoods] : []),
    ...(manifest.coastline ? [manifest.coastline] : []),
    ...manifest.chunks.flatMap(c => [...c.lods, c.terrain, c.collision, ...(c.aerial ? [c.aerial] : [])])];
  const seen = new Map<string, Artifact>(), objects: PublishedObject[] = [];
  for (const asset of references) {
    if (!validPath.test(asset.path)) throw new Error(`Not a public map artifact: ${asset.path}`);
    const prior = seen.get(asset.path);
    if (prior && JSON.stringify(prior) !== JSON.stringify(asset)) throw new Error(`Conflicting artifact: ${asset.path}`);
    if (prior) continue;
    seen.set(asset.path, asset);
    const rawPath = await realpath(join(root, asset.path)), compressedPath = runtimeGzip.has(asset.path) ? rawPath : await realpath(join(root, `${asset.path}.gz`));
    if (![rawPath,compressedPath].every(p => p.startsWith(root + sep))) throw new Error('Map artifact escapes output directory');
    const raw = await readFile(rawPath), compressed = runtimeGzip.get(asset.path) ?? await readFile(compressedPath);
    if (raw.length !== asset.bytes || compressed.length !== asset.gzipBytes || digest(raw) !== asset.sha256 || digest(gunzipSync(compressed)) !== asset.sha256) throw new Error(`Corrupt artifact or gzip sibling: ${asset.path}`);
    if (raw.length > 25_000_000 || compressed.length > 25_000_000) throw new Error(`Artifact exceeds 25 MB: ${asset.path}`);
    // Freeze upload bytes away from the active bake. A new build cannot change this release mid-upload.
    const file = join(directory,release,`${asset.path}.gz`);
    await atomicWrite(file,compressed);
    objects.push({ key: `${prefix}/${asset.path}`, file, bytes: compressed.length, decodedBytes: raw.length,
      sha256: digest(compressed), contentType: type(asset.path), contentEncoding: 'gzip', cacheControl: 'public, max-age=31536000, immutable' });
    // gtasf-7vt00 (mapBrotliAssets): the whole-city graph also ships a brotli twin (10.9 MB gzip -> ~6.2 MB br), served by
    // worker/src/map/assets.ts to clients that send 'br'. The gzip object stays the canonical one (Durable Objects read it).
    if (asset.path === 'roadgraph.bin') {
      const br = brotliCompressSync(raw,{params:{[zlibConstants.BROTLI_PARAM_QUALITY]:11,[zlibConstants.BROTLI_PARAM_SIZE_HINT]:raw.length}});
      if (digest(brotliDecompressSync(br)) !== asset.sha256) throw new Error(`Corrupt brotli twin: ${asset.path}`);
      if (br.length > 25_000_000) throw new Error(`Brotli twin exceeds 25 MB: ${asset.path}`);
      const brFile = join(directory,release,`${asset.path}.br`);
      await atomicWrite(brFile,br);
      objects.push({ key: `${prefix}/${asset.path}.br`, file: brFile, bytes: br.length, decodedBytes: raw.length,
        sha256: digest(br), contentType: type(asset.path), contentEncoding: 'br', cacheControl: 'public, max-age=31536000, immutable', alternativeOf: `${prefix}/${asset.path}` });
    }
  }
  // Budget counts what a client downloads once: the gzip objects (a .br twin is an alternative encoding of one of them).
  manifest.stats.gzipBytes = objects.filter(o => o.contentEncoding === 'gzip').reduce((n,o)=>n+o.bytes,0);
  manifest.stats.withinBudget = manifest.stats.gzipBytes <= manifest.stats.budgetBytes;
  // Rewritten absolute URLs keep one coherent release even if the stable alias changes later.
  for (const asset of references) asset.path = `/${prefix}/${asset.path}`;
  const encoded = Buffer.from(JSON.stringify(manifest,null,2)+'\n'), compressed = gzipSync(encoded,{level:9});
  const file = join(directory,release,'manifest.json.gz');
  await atomicWrite(join(directory,release,'manifest.json'),encoded); await atomicWrite(file,compressed);
  objects.sort((a,b) => a.key.localeCompare(b.key));
  objects.push({ key: `${prefix}/manifest.json`, file, bytes: compressed.length, decodedBytes: encoded.length,
    sha256: digest(compressed), contentType: 'application/json', contentEncoding: 'gzip', cacheControl: 'public, max-age=31536000, immutable' });
  // This is intentionally the final object. Failed uploads leave the previous release playable.
  // The stable alias defaults to the manifest's area; `alias` lets a whole-city bake publish under the
  // path the client already fetches (e.g. the sf bake served at map/lombard/ — zero client change,
  // since every chunk/runtime URL above is already rewritten to the release path). (gtasf-o0cb/v62k)
  if (alias && !/^[a-z0-9-]+$/.test(alias)) throw new Error('Publication alias must be a slug');
  objects.push({ ...objects.at(-1)!, key: `map/${alias ?? manifest.area}/manifest.json`, cacheControl: 'public, max-age=0, must-revalidate' });
  const publication: Publication = { version:1, area:manifest.area, release, sourceManifestSha256,
    // A .br twin is an alternative encoding of an object already counted, so it stays out of the budget totals.
    bytes:objects.filter(o=>o.contentEncoding==='gzip').reduce((n,o)=>n+o.bytes,0), decodedBytes:objects.filter(o=>o.contentEncoding==='gzip').reduce((n,o)=>n+o.decodedBytes,0), objects };
  // Honour the manifest's area budget: 25 MB for a slice/first-load bake, 80 MB for the streamed
  // whole-city bake (config.ts). The per-file 25 MB cap above is unconditional in both cases. (gtasf-o0cb)
  if (publication.bytes > manifest.stats.budgetBytes) throw new Error(`Map publication ${publication.bytes} exceeds the ${manifest.stats.budgetBytes}-byte compressed map budget`);
  await atomicWrite(join(directory,'publication.json'),JSON.stringify(publication,null,2)+'\n');
  return { publication, directory };
}

/** Parse JSONC comments/trailing commas without executing config code or altering quoted strings. */
function jsonc(source: string): unknown {
  return JSON.parse(source.replace(/"(?:[^"\\]|\\.)*"|\/\/[^\r\n]*|\/\*[\s\S]*?\*\//g,token=>token.startsWith('"')?token:' ')
    .replace(/"(?:[^"\\]|\\.)*"|,(?=\s*[}\]])/g,token=>token.startsWith('"')?token:''));
}
/** A safe offline preflight; reads identifiers only and never invokes Wrangler. */
export async function validateUploadTarget(config: string, target: 'staging'|'production'): Promise<{accountId:string;bucket:string}> {
  const resources = JSON.parse(await readFile(join(repo,'tools/deploy/staging-resources.json'),'utf8')) as {accountId:string;r2:string};
  const staging = jsonc(await readFile(config,'utf8')) as {account_id?:string;vars?:{ENVIRONMENT?:string};r2_buckets?:{binding:string;bucket_name:string}[]};
  const bucket = target === 'production' ? 'gtasf-assets-production' : resources.r2;
  if (staging.account_id !== resources.accountId || staging.vars?.ENVIRONMENT !== target || !staging.r2_buckets?.some(b=>b.binding==='ASSETS'&&b.bucket_name===bucket)) throw new Error(`Config does not bind the confirmed GTASF ${target} account and bucket`);
  return {accountId:resources.accountId,bucket};
}
/** Explicit upload uses only the configured GTASF account and chosen environment bucket. A single
 *  process with one S3 connection pool (r2upload) — never one wrangler child per object, which at
 *  whole-city scale (~7600 objects) collapses the machine. Credentials: R2_S3_* in the environment. */
async function upload(publication: Publication, config: string, target: 'staging'|'production', limit = Infinity): Promise<void> {
  const {accountId,bucket} = await validateUploadTarget(config,target);
  // --limit uploads only the first N objects of the plan (gtasf-o0cb). The stable alias is always the
  // final object, so any limit < objects.length publishes the content-addressed release additively and
  // never flips the live alias (uploadToR2 writes its last argument to its own release key). Use for a
  // safe 1-object test and for an additive full-release upload pending alias-flip approval.
  const objects = limit >= publication.objects.length ? publication.objects : publication.objects.slice(0, limit);
  await uploadToR2(r2Credentials(accountId,bucket), objects, async object => {
    // Recheck just before sending, including the manifest generated for this plan.
    const buf = await readFile(object.file);
    if (digest(buf) !== object.sha256) throw new Error(`Publication bytes changed: ${object.key}`);
    return buf;
  });
  if (objects !== publication.objects) console.log(`S3 upload limited to ${objects.length} objects; stable alias NOT uploaded (additive release only)`);
}
/** Founder-directed fallback when no R2 S3 token exists (deploy #4, gtasf-citywide-routing): upload each
 *  object with `wrangler r2 object put` over the OAuth login, through a small bounded pool (one wrangler
 *  child per object is slow, so keep the pool low — e.g. 5). Alias uploaded last so an interrupted run
 *  leaves the previous release live. --limit uploads only the first N release objects (for a safe test). */
async function uploadViaWrangler(config: string, target: 'staging'|'production', objects: PublishedObject[], concurrency: number, limit = Infinity): Promise<void> {
  const {accountId,bucket} = await validateUploadTarget(config,target);
  const wrangler = join(repo,'node_modules','.bin','wrangler');
  const env = { ...process.env, CLOUDFLARE_ACCOUNT_ID: accountId };
  const put = (o: PublishedObject) => new Promise<void>((res,rej) => {
    readFile(o.file).then(buf => {
      if (digest(buf) !== o.sha256) return rej(new Error(`Publication bytes changed: ${o.key}`));
      const args = ['r2','object','put',`${bucket}/${o.key}`,'--file',o.file,'--content-type',o.contentType,'--content-encoding',o.contentEncoding,'--cache-control',o.cacheControl,'--remote'];
      const child = spawn(wrangler,args,{env,stdio:['ignore','ignore','pipe']});
      let err=''; child.stderr.on('data',(d:Buffer)=>{err+=d;});
      child.on('error',rej);
      child.on('close',code=>code===0?res():rej(new Error(`wrangler put ${o.key} -> exit ${code}: ${err.slice(-300)}`)));
    }).catch(rej);
  });
  const full = limit >= objects.length;
  const release = full ? objects.slice(0,-1) : objects.slice(0,limit);
  let next=0, done=0;
  const worker = async () => { while(next<release.length){ const i=next++; await put(release[i]!); if(++done%100===0)console.log(`uploaded ${done}/${release.length}`); } };
  await Promise.all(Array.from({length:Math.min(concurrency,release.length||1)},worker));
  if (full) { await put(objects.at(-1)!); console.log(`uploaded ${release.length} release objects + alias via wrangler (pool ${concurrency})`); }
  else console.log(`TEST: uploaded ${release.length} objects via wrangler (pool ${concurrency}); alias NOT uploaded`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const option = (name: string) => process.argv.find(a=>a.startsWith(`--${name}=`))?.slice(name.length+3);
  preparePublication(resolve(option('root') ?? join(repo,'tools/map/out/lombard')),option('output'),option('alias')).then(async ({publication,directory}) => {
    const config = option('config'), target = option('target') ?? 'staging';
    if (target !== 'staging' && target !== 'production') throw new Error('--target must be staging or production');
    if (config) await validateUploadTarget(resolve(config),target);
    if (process.argv.includes('--upload')) {
      if (!config) throw new Error('--upload requires --config=... and --target=staging|production (default staging)');
      if (process.argv.includes('--via-wrangler'))
        await uploadViaWrangler(resolve(config),target,publication.objects,Number(option('wrangler-pool'))||5,Number(option('limit'))||Infinity);
      else await upload(publication,resolve(config),target,Number(option('limit'))||Infinity);
    }
    console.log(JSON.stringify({directory,target,configValidated:Boolean(config),release:publication.release,objects:publication.objects.length,gzipBytes:publication.bytes,alternativeEncodings:publication.objects.filter(o=>o.alternativeOf).map(o=>({key:o.key,of:o.alternativeOf,encoding:o.contentEncoding,transferBytes:o.bytes,decodedBytes:o.decodedBytes})),decodedBytes:publication.decodedBytes,uploaded:process.argv.includes('--upload')}));
  }).catch(error=>{console.error(error);process.exitCode=1;});
}
