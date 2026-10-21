import { afterEach, expect, it, vi } from 'vitest';
import { createRoadDetails } from './roads';

afterEach(() => vi.unstubAllGlobals());

it('starts the five bounded road maps together and waits for late decodes before failure cleanup', async () => {
  const finish: ((response: Response) => void)[] = [], close = vi.fn();
  vi.stubGlobal('createImageBitmap', async () => ({ width: 256, height: 256, close }));
  vi.stubGlobal('fetch', vi.fn(async (path: string) => {
    if (path === '/art/road-details.json') return Response.json({ version: 1, roads: [], tracks: [], crossings: [] });
    return new Promise<Response>(resolve => { finish.push(resolve); });
  }));
  let settled = false;
  const job = createRoadDetails({ enabled: true, detail: false, realistic: false,
    position: { x: 0, z: 0 }, heightAt: () => 0, collides: () => false }).catch(error => { settled = true; return error; });
  await vi.waitFor(() => expect(finish).toHaveLength(5));
  finish[0]!(new Response('', { status: 503 }));
  for (const resolve of finish.slice(1, 4)) resolve(new Response(new ArrayBuffer(0)));
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(settled).toBe(false); expect(close).not.toHaveBeenCalled();
  finish[4]!(new Response(new ArrayBuffer(0)));
  expect(await job).toEqual(new Error('Road detail texture HTTP 503'));
  expect(close).toHaveBeenCalledTimes(4);
});
