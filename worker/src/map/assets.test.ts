import { describe, expect, it, vi } from 'vitest';
vi.mock('@gtasf/shared/flags', async (orig) => {
  const actual = await orig<typeof import('@gtasf/shared/flags')>();
  return { ...actual, flags: { ...actual.flags } }; // writable copy so a test can toggle mapBrotliAssets
});
import { flags } from '@gtasf/shared/flags';
import { serveMapAsset } from './assets';

const release = 'a'.repeat(64);
function bucket(keys: string[]): R2Bucket {
  const object = (key: string) => keys.includes(key) ? {
    body: new Response('x').body, httpEtag: '"e"', httpMetadata: {},
    writeHttpMetadata() {},
  } : null;
  return { get: async (key: string) => object(key), head: async (key: string) => object(key) } as unknown as R2Bucket;
}

describe('serveMapAsset', () => {
  it('serves the whole-city packed road graph from a release (citywide routing, gtasf-u4al)', async () => {
    const key = `map/releases/${release}/roadgraph.bin`;
    const response = await serveMapAsset(new Request(`https://gtasf.test/${key}`), bucket([key]));
    expect(response?.status).toBe(200);
  });
  it('serves the near-spawn graph and its parts, in a release and under map/near/<sha> (gtasf-0k01)', async () => {
    const keys = [`map/releases/${release}/roadgraph-near.bin`, `map/near/${release}/roadgraph-near.bin`, `map/near/${release}/roadgraph-near-ferry_building.bin`];
    for (const key of keys) {
      const response = await serveMapAsset(new Request(`https://gtasf.test/${key}`), bucket(keys));
      expect(response?.status).toBe(200);
      expect(response?.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable');
    }
    expect((await serveMapAsset(new Request(`https://gtasf.test/map/near/${release}/roadgraph.bin`), bucket(keys)))?.status).toBe(404);
    expect((await serveMapAsset(new Request(`https://gtasf.test/map/near/short/roadgraph-near.bin`), bucket(keys)))?.status).toBe(404);
  });
  it('mapBrotliAssets: serves the roadgraph.bin brotli twin only to explicit br clients, else the gzip object (gtasf-7vt00)', async () => {
    const key = `map/releases/${release}/roadgraph.bin`, twin = `${key}.br`;
    const store: R2Bucket = { get: async (k: string) => k === key ? { body: new Response('gz').body, httpEtag: '"g"', size: 2, httpMetadata: { contentEncoding: 'gzip' }, writeHttpMetadata(h: Headers) { h.set('Content-Encoding', 'gzip'); } }
      : k === twin ? { body: new Response('b').body, httpEtag: '"b"', size: 1, httpMetadata: { contentEncoding: 'br' }, writeHttpMetadata(h: Headers) { h.set('Content-Type', 'application/octet-stream'); } } : null,
      head: async () => null } as unknown as R2Bucket;
    const get = (encoding: string, extra: Record<string, string> = {}) => serveMapAsset(new Request(`https://gtasf.test/${key}`, { headers: { 'Accept-Encoding': encoding, ...extra } }), store);
    const was = flags.mapBrotliAssets;
    try {
      (flags as { mapBrotliAssets: boolean }).mapBrotliAssets = false;
      expect((await get('br, gzip'))?.headers.get('Content-Encoding')).toBe('gzip'); // flag off: unchanged
      (flags as { mapBrotliAssets: boolean }).mapBrotliAssets = true;
      const br = await get('gzip, deflate, br');
      expect(br?.headers.get('Content-Encoding')).toBe('br'); expect(br?.headers.get('ETag')).toBe('"b"'); expect(br?.headers.get('Vary')).toBe('Accept-Encoding');
      expect(await br?.text()).toBe('b');
      expect((await get('gzip'))?.headers.get('Content-Encoding')).toBe('gzip'); // no br: gzip object
      expect((await get('*'))?.headers.get('Content-Encoding')).toBe('gzip'); // wildcard keeps the gzip path
      expect((await get('br;q=0, gzip'))?.headers.get('Content-Encoding')).toBe('gzip'); // br refused
      expect((await get('br', { 'If-None-Match': '"b"' }))?.status).toBe(304);
      const chunk = `map/releases/${release}/chunks/1_2/lod0.glb`; // chunks never look for a twin
      const seen: string[] = [];
      await serveMapAsset(new Request(`https://gtasf.test/${chunk}`, { headers: { 'Accept-Encoding': 'br' } }), { get: async (k: string) => { seen.push(k); return null; }, head: async () => null } as unknown as R2Bucket);
      expect(seen).toEqual([chunk]);
    } finally { (flags as { mapBrotliAssets: boolean }).mapBrotliAssets = was; }
  });
  it('still rejects arbitrary bucket keys', async () => {
    const response = await serveMapAsset(new Request(`https://gtasf.test/map/releases/${release}/secret.bin`), bucket([]));
    expect(response?.status).toBe(404);
  });
});
