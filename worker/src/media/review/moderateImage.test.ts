import { describe, expect, it, vi } from 'vitest';
import { handleModerateImage, MAX_MODERATION_IMAGE_BYTES } from './moderateImage';
import type { Env } from '../../env';
import type { PrescreenCall } from '../prescreen/haiku';

const okResult = {
  status: 'ok', detail: 'ok', usage: { input_tokens: 1, output_tokens: 1 },
  costMicrousd: 6, latencyMs: 0, retryable: false, output: { summary: 's' },
} as unknown as PrescreenCall;

function mkEnv(object: { bytes: Uint8Array; contentType?: string } | null, apiKey: string | null = 'sk-or') {
  const puts: Record<string, string> = {};
  const ASSETS = {
    get: vi.fn(async (_key: string) => object ? {
      arrayBuffer: async () => object.bytes.slice().buffer,
      httpMetadata: object.contentType ? { contentType: object.contentType } : undefined,
    } : null),
    put: vi.fn(async (key: string, value: string) => { puts[key] = value; }),
  };
  return { env: { OPENROUTER_API_KEY: apiKey ?? undefined, ASSETS } as unknown as Env, ASSETS, puts };
}

describe('handleModerateImage', () => {
  it('skips (null) and never fetches when OpenRouter is not configured', async () => {
    const { env, ASSETS } = mkEnv({ bytes: new Uint8Array([1, 2]) }, null);
    const prescreen = vi.fn();
    expect(await handleModerateImage('outbid/quarantine/a', env, { prescreen: prescreen as never })).toBeNull();
    expect(ASSETS.get).not.toHaveBeenCalled();
    expect(prescreen).not.toHaveBeenCalled();
  });

  it('returns null when the quarantined object is gone', async () => {
    const { env } = mkEnv(null);
    const prescreen = vi.fn(async () => okResult);
    expect(await handleModerateImage('k', env, { prescreen: prescreen as never })).toBeNull();
    expect(prescreen).not.toHaveBeenCalled();
  });

  it('returns null (no prescreen) for an oversized object', async () => {
    const { env } = mkEnv({ bytes: new Uint8Array(MAX_MODERATION_IMAGE_BYTES + 1) });
    const prescreen = vi.fn(async () => okResult);
    expect(await handleModerateImage('k', env, { prescreen: prescreen as never })).toBeNull();
    expect(prescreen).not.toHaveBeenCalled();
  });

  it('prescreens with the stored MIME and writes the advisory sidecar', async () => {
    const { env, puts } = mkEnv({ bytes: new Uint8Array([1, 2, 3]), contentType: 'image/png' });
    const prescreen = vi.fn(async (_deps: { mediaType: string }) => okResult);
    const res = await handleModerateImage('outbid/quarantine/a', env, { prescreen: prescreen as never, now: () => 1234 });
    expect(res).toBe(okResult);
    expect(prescreen.mock.calls[0]![0].mediaType).toBe('image/png');
    const sidecar = JSON.parse(puts['outbid/quarantine/a.prescreen.json']!);
    expect(sidecar).toMatchObject({ key: 'outbid/quarantine/a', status: 'ok', at: 1234 });
  });

  it('falls back to image/webp for an unexpected MIME', async () => {
    const { env } = mkEnv({ bytes: new Uint8Array([1]), contentType: 'image/gif' });
    const prescreen = vi.fn(async (_deps: { mediaType: string }) => okResult);
    await handleModerateImage('k', env, { prescreen: prescreen as never });
    expect(prescreen.mock.calls[0]![0].mediaType).toBe('image/webp');
  });
});
