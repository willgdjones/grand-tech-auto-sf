import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { PublishedObject } from '../src/pack/publication';
import { uploadToR2 } from '../src/pack/r2upload';

type Reply = number | 'stall' | { code: string; message?: string };
const wire = vi.hoisted(() => ({
  replies: new Map<string, Reply[]>(),
  calls: [] as { method: string; path: string; headers: Record<string, string | number>; body: Buffer }[],
  destroy: vi.fn(),
}));

vi.mock('node:https', async () => {
  const { EventEmitter } = await import('node:events');
  return {
    Agent: class { destroy = wire.destroy; },
    request(options: { method: string; path: string; headers: Record<string, string | number> }, callback: (response: unknown) => void) {
      const req = Object.assign(new EventEmitter(), {
        end(body: Buffer) {
          wire.calls.push({ ...options, body });
          const key = `${options.method} ${options.path}`;
          const reply = wire.replies.get(key)?.shift();
          if (reply === undefined) throw new Error(`Unexpected request: ${key}`);
          queueMicrotask(() => {
            if (reply === 'stall') return;
            if (typeof reply !== 'number') { req.emit('error', Object.assign(new Error(reply.message ?? reply.code), reply)); return; }
            const response = Object.assign(new EventEmitter(), { statusCode: reply });
            callback(response);
            response.emit('end');
          });
        },
        destroy(error: Error) { req.emit('error', error); },
      });
      return req;
    },
  };
});

const target = { endpoint: 'https://example.invalid', region: 'auto', bucket: 'test-map', accessKeyId: 'fixture', secretAccessKey: 'fixture' };
const prefix = `map/releases/${'a'.repeat(64)}/`;
const object = (key: string): PublishedObject => ({ key, file: 'unused', bytes: 4, decodedBytes: 4, sha256: 'unused',
  contentType: 'application/json', contentEncoding: 'gzip', cacheControl: 'public, max-age=31536000, immutable' });
const alias = { ...object('map/lombard/manifest.json'), cacheControl: 'public, max-age=0, must-revalidate' };
const plan = (method: string, obj: PublishedObject, ...replies: Reply[]) => wire.replies.set(`${method} /${target.bucket}/${obj.key}`, replies);
const read = vi.fn(async (_object: PublishedObject) => Buffer.from('data'));
const calls = () => wire.calls.map(({ method, path }) => `${method} ${path.slice(target.bucket.length + 2)}`);

beforeEach(() => {
  vi.useFakeTimers();
  wire.calls.length = 0; wire.replies.clear(); wire.destroy.mockClear(); read.mockClear();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

it('resumes immutable objects, retries transient HEAD/PUT failures and always writes the alias last', async () => {
  const existing = object(prefix + 'existing.json'), missing = object(prefix + 'new.json');
  plan('HEAD', existing, 200);
  plan('HEAD', missing, 503, 404);
  plan('PUT', missing, { code: 'EPROTO', message: 'ssl3_read_bytes:bad record mac, alert 20' }, { code: 'ERR_SSL_SSLV3_ALERT_BAD_RECORD_MAC' }, 200);
  plan('PUT', alias, 200);
  const upload = uploadToR2(target, [existing, missing, alias], read, 1);
  await vi.runAllTimersAsync();
  await upload;
  expect(calls()).toEqual([`HEAD ${existing.key}`, `HEAD ${missing.key}`, `HEAD ${missing.key}`, `PUT ${missing.key}`, `PUT ${missing.key}`, `PUT ${missing.key}`, `PUT ${alias.key}`]);
  expect(read.mock.calls.map(([item]) => item.key)).toEqual([existing.key, missing.key, alias.key]);
  expect(wire.calls[0]!.body.length).toBe(0);
  expect(wire.calls[0]!.headers['x-amz-content-sha256']).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  expect(wire.calls.at(-1)!.headers['cache-control']).toBe(alias.cacheControl);
  expect(wire.destroy).toHaveBeenCalledOnce();
});

it('bounds retries and keeps the prior alias after exhausted network failures', async () => {
  const first = object(prefix + 'first.json'), later = object(prefix + 'later.json');
  plan('HEAD', first, 404);
  plan('PUT', first, { code: 'ECONNRESET' }, { code: 'ECONNRESET' }, { code: 'ECONNRESET' });
  const rejection = expect(uploadToR2(target, [first, later, alias], read, 1)).rejects.toThrow('ECONNRESET');
  await vi.runAllTimersAsync();
  await rejection;
  expect(calls()).toEqual([`HEAD ${first.key}`, `PUT ${first.key}`, `PUT ${first.key}`, `PUT ${first.key}`]);
  expect(read).toHaveBeenCalledTimes(1);
  expect(wire.destroy).toHaveBeenCalledOnce();
});

it('fails authentication and certificate errors immediately and still cleans up', async () => {
  const item = object(prefix + 'protected.json');
  for (const reply of [403, { code: 'CERT_HAS_EXPIRED' }] as const) {
    plan('HEAD', item, reply);
    await expect(uploadToR2(target, [item, alias], read, 1)).rejects.toThrow();
  }
  expect(calls()).toEqual([`HEAD ${item.key}`, `HEAD ${item.key}`]);
  expect(wire.destroy).toHaveBeenCalledTimes(2);
});

it('retries a timed-out request, but never skips mutable release-list objects', async () => {
  const mutable = object('map/lombard/roadgraph.json');
  plan('PUT', mutable, 'stall', 200);
  plan('PUT', alias, 200);
  const upload = uploadToR2(target, [mutable, alias], read, 1);
  await vi.runAllTimersAsync();
  await upload;
  expect(calls()).toEqual([`PUT ${mutable.key}`, `PUT ${mutable.key}`, `PUT ${alias.key}`]);
  expect(wire.destroy).toHaveBeenCalledOnce();
});

it('preserves local hash failures before HEAD and rejects a pool that could skip release work', async () => {
  await expect(uploadToR2(target, [object(prefix + 'changed.json'), alias], async () => { throw new Error('Publication bytes changed'); }, 1)).rejects.toThrow('Publication bytes changed');
  await expect(uploadToR2(target, [alias], read, 0)).rejects.toThrow('positive integer');
  expect(wire.calls).toHaveLength(0);
  expect(wire.destroy).toHaveBeenCalledOnce();
});
