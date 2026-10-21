/** One local workerd/R2 check; no remote upload or full Worker build. */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

const root = fileURLToPath(new URL('../../',import.meta.url));
const directory = resolve(root,'tools/map/out/publication-lombard');
const plan = JSON.parse(await readFile(`${directory}/publication.json`,'utf8'));
const bundle = await build({ stdin:{contents:`import {serveMapAsset} from './worker/src/map/assets'; export default {async fetch(request, env) {return await serveMapAsset(request,env.ASSETS) ?? new Response('other',{status:404});}}`,resolveDir:root,loader:'ts'},bundle:true,format:'esm',platform:'browser',write:false,target:'es2022',logLevel:'error' });
const worker = new Miniflare(convertV4MiniflareOptions({ cf:false, telemetry:{enabled:false}, workers:[{ name:'map-publication-smoke', modules:true, script:bundle.outputFiles[0].text, compatibilityDate:'2026-09-28', r2Buckets:['ASSETS'] }] }));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
try {
  const url = await worker.ready, bucket = await worker.getR2Bucket('ASSETS');
  const manifest = plan.objects.at(-1), chunk = plan.objects.find(o=>o.key.endsWith('/lod0.glb')), graph = plan.objects.find(o=>o.key.endsWith('/roadgraph-playable.json'));
  for (const object of [manifest,chunk,graph]) await bucket.put(object.key,await readFile(object.file),{httpMetadata:{contentType:object.contentType,contentEncoding:object.contentEncoding,cacheControl:object.cacheControl}});
  const get = (key,init) => fetch(new URL(`/${key}`,url),init);
  const compressed = await get(manifest.key,{headers:{'Accept-Encoding':'gzip'}});
  assert.equal(compressed.status,200); assert.equal(compressed.headers.get('content-encoding'),'gzip');
  assert.equal(compressed.headers.get('content-length'),String(manifest.bytes));
  const decoded = await compressed.json();
  assert(decoded.chunks[0].lods[0].path.startsWith(`/map/releases/${plan.release}/`));
  const identity = await get(manifest.key,{headers:{'Accept-Encoding':'gzip;q=0, identity'}});
  assert.equal(identity.headers.get('content-encoding'),null);
  assert.deepEqual(await identity.json(),decoded);
  const alias = await get('map/lombard/roadgraph-playable.json',{redirect:'manual'});
  assert.equal(alias.status,302); assert.equal(alias.headers.get('location'),`/${graph.key}`);
  const routing = await get('map/lombard/roadgraph-playable.json');
  assert((await routing.json()).edges.length > 100);
  const geometry = await get(chunk.key,{headers:{'Accept-Encoding':'gzip'}}), bytes = Buffer.from(await geometry.arrayBuffer());
  assert.equal(bytes.toString('ascii',0,4),'glTF'); assert.equal(bytes.length,chunk.decodedBytes);
  assert.equal(geometry.headers.get('content-type'),'model/gltf-binary');
  const head = await get(chunk.key,{method:'HEAD',headers:{'Accept-Encoding':'gzip'}});
  assert.equal(head.status,200); assert.equal(head.headers.get('content-length'),String(chunk.bytes));
  assert.equal((await head.arrayBuffer()).byteLength,0);
  assert.equal((await get(chunk.key,{headers:{'If-None-Match':head.headers.get('etag'),'Accept-Encoding':'gzip'}})).status,304);
  assert.equal((await get('map/private/ad.png')).status,404);
  assert.equal((await get(`map/releases/${plan.release}/cache/sources.json`)).status,404);
  assert.equal((await get(manifest.key,{method:'POST'})).status,405);
  const report = {checkedAt:new Date().toISOString(),passed:true,release:plan.release,objects:plan.objects.length,gzipBytes:plan.bytes,decodedBytes:plan.decodedBytes,chunkDecodedSha256:sha(bytes),checks:['real-R2-gzip-manifest','identity-negotiation','playable-graph-alias','decoded-GLB','HEAD','conditional-304','invalid-paths','method-rejection'],remoteUpload:false};
  await writeFile(`${directory}/smoke.json`,JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report));
} finally { await worker.dispose(); }
