import { expect, test, vi } from 'vitest';
import { FERRY, placePoint, resolveSpawn, snapSpawn } from './locations';
import { createRoadSampler } from '../render/chunks/terrain';
import type { LombardWorld } from '../render/chunks/world';
import { Box3, Vector3 } from 'three';

test('bounded event failures reach registered offices while landmark/event priority stays intact', async () => {
  vi.useFakeTimers();
  const url = new URL('https://gtasf.test/go/example-office?ref=friend');
  const office = { slug: 'example-office', lat: 37.795, lon: -122.394, heading: 90 };
  let signal: AbortSignal | undefined;
  const failures: (() => Promise<Response>)[] = [
    async () => { throw new TypeError('Network unavailable'); },
    async () => new Response('not json'),
    async () => Response.json({ events: {} }),
    async () => new Response(null, { status: 503 }),
    () => new Promise(() => {}),
    async () => ({ ok: true, status: 200, json: () => new Promise(() => {}) }) as Response,
  ];
  try {
    for (const failure of failures) {
      const fetcher = vi.fn((path: string, init: RequestInit) => {
        if (path === '/api/events') { signal = init.signal as AbortSignal; return failure(); }
        expect(path).toBe('/api/gtm/spawns/example-office'); return Promise.resolve(Response.json(office));
      });
      vi.stubGlobal('fetch', fetcher);
      const pending = resolveSpawn(url);
      await vi.advanceTimersByTimeAsync(4000);
      expect(await pending).toEqual({ explicit: true, place: { ...office, title: 'example office' } });
      expect(fetcher).toHaveBeenCalledTimes(failure === failures[0] || failure === failures[3] ? 3 : 2);
      expect(vi.getTimerCount()).toBe(0);
      if (failure === failures[4] || failure === failures[5]) expect(signal!.aborted).toBe(true);
    }

    const event = { id: 'example-office', title: 'Canonical event', lat: 37.8, lon: -122.4, url: 'https://example.com/event', approx: true };
    const fetcher = vi.fn(async () => Response.json({ events: [null, { ...event, id: 'alias', url: 'https://example.com/example-office' }, event] }));
    vi.stubGlobal('fetch', fetcher);
    expect(await resolveSpawn(new URL('https://gtasf.test/go/ferry-building'))).toEqual({ explicit: true, place: FERRY });
    expect(fetcher).not.toHaveBeenCalled();
    expect(await resolveSpawn(url)).toMatchObject({ explicit: true, place: { title: event.title, eventId: event.id, lat: event.lat, lon: event.lon } });
    expect(fetcher).toHaveBeenCalledTimes(1); // Canonical ID wins over an earlier URL alias and the office.

    vi.stubGlobal('fetch', vi.fn(async (path: string) => path === '/api/events'
      ? Response.json({ events: [] }) : new Response(null, { status: 404 })));
    await expect(resolveSpawn(url)).rejects.toThrow('Unknown place');
    vi.stubGlobal('fetch', vi.fn(async (path: string) => path === '/api/events'
      ? Response.json({ events: [] }) : Response.json({ slug: office.slug, lat: null, lon: office.lon })));
    await expect(resolveSpawn(url)).rejects.toThrow('temporarily unavailable');

    let officeSignal: AbortSignal | undefined;
    vi.stubGlobal('fetch', vi.fn((path: string, init: RequestInit) => {
      if (path === '/api/events') return Promise.resolve(Response.json({ events: [] }));
      officeSignal = init.signal as AbortSignal; return new Promise<Response>(() => {});
    }));
    const unavailable = expect(resolveSpawn(url)).rejects.toThrow('temporarily unavailable');
    await vi.advanceTimersByTimeAsync(4000); await unavailable;
    expect(officeSignal!.aborted).toBe(true); expect(vi.getTimerCount()).toBe(0);
  } finally { vi.unstubAllGlobals(); vi.useRealTimers(); }
});

test('initial calendar and office GETs recover once without changing source priority', async () => {
  vi.useFakeTimers();
  const event = { id: 'canonical-event', title: 'Canonical event', lat: 37.79, lon: -122.4, url: 'https://example.com/event-alias' };
  const office = { slug: 'registered-office', title: 'Reviewed office', lat: 37.8, lon: -122.4 };
  const failures: (() => Promise<Response>)[] = [
    ...[408, 429, 500, 503].map(status => async () => new Response('Unavailable', { status })),
    async () => { throw new TypeError('Network unavailable'); },
    async () => new Response(new ReadableStream({ start(controller) { controller.error(new TypeError('Body interrupted')); } })),
  ];
  try {
    for (const failure of failures) {
      let attempts = 0;
      const fetcher = vi.fn(async (path: string) => {
        expect(path).toBe('/api/events');
        return ++attempts === 1 ? failure() : Response.json({ events: [event] });
      });
      vi.stubGlobal('fetch', fetcher);
      const pending = resolveSpawn(new URL('https://gtasf.test/go/event-alias'));
      await vi.advanceTimersByTimeAsync(749); expect(fetcher).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(await pending).toMatchObject({ explicit: true, place: { eventId: event.id, title: event.title } });
      expect(fetcher).toHaveBeenCalledTimes(2); expect(vi.getTimerCount()).toBe(0);
    }
    let officeAttempts = 0;
    const fetcher = vi.fn(async (path: string) => path === '/api/events' ? Response.json({ events: [] })
      : ++officeAttempts === 1 ? new Response(null, { status: 503 }) : Response.json(office));
    vi.stubGlobal('fetch', fetcher);
    const pending = resolveSpawn(new URL('https://gtasf.test/go/registered-office'));
    await vi.advanceTimersByTimeAsync(750);
    expect(await pending).toEqual({ explicit: true, place: office });
    expect(fetcher.mock.calls.map(([path]) => path)).toEqual(['/api/events', '/api/gtm/spawns/registered-office', '/api/gtm/spawns/registered-office']);
    expect(vi.getTimerCount()).toBe(0);
  } finally { vi.unstubAllGlobals(); vi.useRealTimers(); }
});

test('permanent HTTP and malformed responses do not retry or create a destination', async () => {
  vi.useFakeTimers();
  const failures = [400, 401, 403, 404].map(status => () => new Response(null, { status }));
  failures.push(() => new Response('not json'), () => Response.json({ events: 'not a calendar' }));
  try {
    for (const failure of failures) {
      const fetcher = vi.fn(async (path: string) => path === '/api/events' ? failure() : new Response(null, { status: 404 }));
      vi.stubGlobal('fetch', fetcher);
      await expect(resolveSpawn(new URL('https://gtasf.test/go/unavailable-event'))).rejects.toThrow('temporarily unavailable');
      expect(fetcher).toHaveBeenCalledTimes(2); expect(vi.getTimerCount()).toBe(0);
    }
  } finally { vi.unstubAllGlobals(); vi.useRealTimers(); }
});

test('retry delay and a stalled second body stay within the original four-second budget', async () => {
  vi.useFakeTimers();
  const office = { slug: 'registered-office', title: 'Reviewed office', lat: 37.8, lon: -122.4 };
  try {
    for (const failureAt of [0, 3600]) {
      let attempts = 0, signal: AbortSignal | undefined;
      const fetcher = vi.fn((path: string, init: RequestInit) => {
        if (path !== '/api/events') return Promise.resolve(Response.json(office));
        signal = init.signal as AbortSignal;
        if (++attempts === 1) return new Promise<Response>(resolve => setTimeout(() => resolve(new Response(null, { status: 503 })), failureAt));
        const active = signal;
        return Promise.resolve(new Response(new ReadableStream({ start(controller) {
          active.addEventListener('abort', () => controller.error(active.reason), { once: true });
        } })));
      });
      vi.stubGlobal('fetch', fetcher);
      const pending = resolveSpawn(new URL('https://gtasf.test/go/registered-office'));
      await vi.advanceTimersByTimeAsync(3999);
      expect(fetcher.mock.calls.some(([path]) => path !== '/api/events')).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(await pending).toEqual({ explicit: true, place: office });
      expect(attempts).toBe(failureAt ? 1 : 2); expect(signal!.aborted).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
      await vi.advanceTimersByTimeAsync(10_000);
      expect(attempts).toBe(failureAt ? 1 : 2); // No delayed retry after office fallback.
    }
  } finally { vi.unstubAllGlobals(); vi.useRealTimers(); }
});

test('explicit bridge and tunnel links keep the sourced road level', async () => {
  const point=placePoint(FERRY);
  for(const height of [12,-12]) {
    const sampler=createRoadSampler({version:1,nodes:[],edges:[{id:'lane:deck',from:'a',to:'b',lengthM:20,speedMps:10,lane:0,
      points:[[point.x-10,height,point.z],[point.x+10,height,point.z]],bridge:height>0,tunnel:height<0}]} as unknown as Parameters<typeof createRoadSampler>[0]);
    const world={ensureAround:async()=>{},nearestRoad:()=>({...point,y:height,yaw:0}),
      surfaceHeightAt:(x:number,z:number,y?:number)=>sampler(x,z,y)??0,collides:()=>false,cameraBoxes:[]} as unknown as LombardWorld;
    expect((await snapSpawn(world,{place:FERRY,explicit:true})).y).toBe(height);
  }
});

test('shared headings keep the chase view and tunnel arrivals ignore buildings overhead', async () => {
  const point=placePoint(FERRY),box=new Box3(new Vector3(point.x+5,40,point.z-10),new Vector3(point.x+25,70,point.z+10));
  const world={ensureAround:async()=>{},nearestRoad:()=>({...point,y:4,yaw:.7}),surfaceHeightAt:()=>4,
    collides:()=>false,cameraBoxes:[box]} as unknown as LombardWorld;
  const directed=await snapSpawn(world,{place:{...FERRY,heading:90},explicit:true});
  expect(directed.focus).toBeNull();expect(directed.yaw).toBeCloseTo(Math.PI/2);
  const undirected=await snapSpawn(world,{place:{...FERRY,heading:undefined},explicit:true});
  expect(undirected.focus).toBeNull();expect(undirected.yaw).toBe(.7);
  box.min.y=4;
  expect((await snapSpawn(world,{place:{...FERRY,heading:undefined},explicit:true})).focus).not.toBeNull();
});
