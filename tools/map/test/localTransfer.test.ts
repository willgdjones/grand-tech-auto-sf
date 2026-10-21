import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, request, type Server } from 'node:http';
import { brotliDecompressSync, gunzipSync, gzipSync } from 'node:zlib';
import { createLocalMapMiddleware } from '../../../web/mapLocalPlugin';
import { writeMapTransfer } from '../src/pipeline/transfer';
import { digest } from '../src/pipeline/sources';

describe('local map transport over HTTP', () => {
  let root: string, server: Server, port: number;
  const raw = Buffer.from('packed graph bytes with repeated nodes and lanes\n'.repeat(1000));
  const manifest = JSON.stringify({ roadGraph: { path: 'roadgraph.bin', bytes: raw.length, sha256: digest(raw) } });
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'gtasf-transfer-'));
    await Promise.all([
      writeFile(join(root, 'roadgraph.bin'), raw), writeFile(join(root, 'roadgraph.bin.gz'), gzipSync(raw)),
      writeFile(join(root, 'manifest.json'), manifest),
    ]);
    await writeMapTransfer(root);
    const middleware = createLocalMapMiddleware(root);
    server = createServer((req, res) => { middleware(req, res, () => { res.writeHead(418).end(); }); });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as { port: number }).port;
  });
  afterEach(async () => {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await rm(root, { recursive: true, force: true });
  });
  function get(encoding?: string, path = '/map/lombard/roadgraph.bin', method = 'GET') {
    return new Promise<{ status: number; headers: import('node:http').IncomingHttpHeaders; body: Buffer }>((resolve, reject) => {
      const req = request({ hostname: '127.0.0.1', port, path, method,
        headers: encoding === undefined ? {} : { 'Accept-Encoding': encoding } }, res => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => resolve({ status: res.statusCode!, headers: res.headers, body: Buffer.concat(chunks) }));
      });
      req.on('error', reject); req.end();
    });
  }
  it('preserves canonical bytes and serves verified Brotli with matching HEAD headers', async () => {
    expect(await readFile(join(root, 'manifest.json'), 'utf8')).toBe(manifest);
    const result = await get('gzip, br');
    expect(result.status).toBe(200);
    expect(result.headers['content-encoding']).toBe('br');
    expect(result.headers.vary).toBe('Accept-Encoding');
    expect(Number(result.headers['content-length'])).toBe(result.body.length);
    expect(brotliDecompressSync(result.body)).toEqual(raw);
    const head = await get('br', undefined, 'HEAD');
    expect(head.headers['content-length']).toBe(result.headers['content-length']);
    expect(head.headers['content-encoding']).toBe('br');
    expect(head.body.length).toBe(0);
  });
  it('honours encoding preferences, exclusions, wildcard, gzip and identity', async () => {
    const gzip = await get('br;q=0, gzip');
    expect(gzip.headers['content-encoding']).toBe('gzip');
    expect(gunzipSync(gzip.body)).toEqual(raw);
    expect((await get('br;q=0.5, gzip;q=1')).headers['content-encoding']).toBe('gzip');
    expect((await get('br;q=0, gzip;q=0')).body).toEqual(raw);
    expect((await get()).body).toEqual(raw);
    expect((await get('*')).headers['content-encoding']).toBe('br');
    expect((await get('*;q=0')).status).toBe(406);
  });
  it('falls back when metadata or encoded bytes are missing, corrupt or replaced after cache verification', async () => {
    expect((await get('br, gzip')).headers['content-encoding']).toBe('br');
    await writeFile(join(root, 'roadgraph.bin.br'), Buffer.alloc(20));
    expect((await get('br, gzip')).headers['content-encoding']).toBe('gzip');
    await writeMapTransfer(root);
    expect((await get('br, gzip')).headers['content-encoding']).toBe('br');
    await writeFile(join(root, 'roadgraph.bin.br.json'), '{invalid');
    expect((await get('br, gzip')).headers['content-encoding']).toBe('gzip');
    await rm(join(root, 'roadgraph.bin.br.json'));
    expect((await get('br')).body).toEqual(raw);
  });
  it('rejects a stale raw graph and refuses producing a sidecar against a mismatched manifest', async () => {
    expect((await get('br')).headers['content-encoding']).toBe('br');
    const changed = Buffer.from(raw); changed[0] = 0;
    await writeFile(join(root, 'roadgraph.bin'), changed);
    expect((await get('br')).body).toEqual(changed);
    await expect(writeMapTransfer(root)).rejects.toThrow('does not match its manifest');
  });
  it('preserves missing-file, traversal and unrelated-route behavior', async () => {
    expect((await get('br', '/map/lombard/missing.bin')).status).toBe(404);
    expect((await get('br', '/map/lombard/%2e%2e/secret.json')).status).toBe(403);
    expect((await get('br', '/map/lombard/%ZZ')).status).toBe(400);
    expect((await get('br', '/elsewhere')).status).toBe(418);
  });
});
