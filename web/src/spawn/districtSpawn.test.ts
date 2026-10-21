import { expect, test, vi } from 'vitest';
import { DISTRICTS } from '../../../tools/map/src/districts';
import { encodeHeightfield } from '../../../tools/map/src/pipeline/heightfield';
import { FERRY, headingToYaw, placePoint, resolveSpawn, snapSpawn } from './locations';
import { loadLombardWorld, type MapManifest } from '../render/chunks/world';

// Exercise real streaming, terrain, collision and snapping with explicit fixture
// geometry. Decoder/GPU work is outside this loading-order smoke, not visual proof.
vi.mock('three/addons/loaders/GLTFLoader.js', async () => {
  const { Group } = await import('three');
  return { GLTFLoader: class {
    setMeshoptDecoder() { return this; }
    async parseAsync() { return { scene: new Group() }; }
  } };
});
vi.mock('three/addons/libs/meshopt_decoder.module.js', () => ({ MeshoptDecoder: { useWorkers() {} } }));

test('district links resolve locally and load the snapped lane before omitted target chunks', async () => {
  const worlds: NonNullable<Awaited<ReturnType<typeof loadLombardWorld>>>[] = [];
  vi.stubGlobal('location', { href: 'https://gtasf.test/' });
  vi.stubGlobal('document', { visibilityState: 'visible' });
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { queueMicrotask(() => callback(0)); return 1; });
  try {
    const noLookup = vi.fn(async () => { throw new Error('Built-in places need no API lookup'); });
    vi.stubGlobal('fetch', noLookup);
    for (const district of DISTRICTS) {
      expect(await resolveSpawn(new URL(`https://gtasf.test/go/${district.id}`)))
        .toEqual({ explicit: true, place: { slug: district.id, title: district.name, ...district.spawn } });
    }
    expect(await resolveSpawn(new URL('https://gtasf.test/'))).toEqual({ explicit: false, place: FERRY });
    expect(await resolveSpawn(new URL('https://gtasf.test/go/castro?at=37.79,-122.4,180')))
      .toMatchObject({ explicit: true, place: { lat: 37.79, lon: -122.4, heading: 180 } });
    expect(noLookup).not.toHaveBeenCalled();

    const target = placePoint(FERRY), lane = { x: target.x + 300, z: target.z };
    const rawX = Math.floor(target.x / 256), laneX = Math.floor(lane.x / 256), cz = Math.floor(lane.z / 256);
    for (const explicit of [false, true]) for (const rawPresent of [false, true]) for (const roadY of [-12, 12]) {
      const chunk = (x: number) => ({ id: `${x}_${cz}`, x, z: cz,
        lods: [{ path: `${x}/mesh.glb`, bytes: 0 }, { path: `${x}/mesh.glb`, bytes: 0 }],
        terrain: { path: `${x}/terrain.bin`, bytes: 40 }, collision: { path: `${x}/collision.json`, bytes: 0 } });
      const manifest: MapManifest = { version: 1, chunkSize: 256, bounds: [rawX * 256, cz * 256, (laneX + 1) * 256, (cz + 1) * 256],
        frame: { origin: { lat: 37.7842, lon: -122.4078 }, gridRotationDeg: 0 }, attribution: {},
        roadGraph: { path: 'roads.json', bytes: 0 }, chunks: [chunk(laneX), ...(rawPresent ? [chunk(rawX)] : [])] };
      const requested: string[] = [];
      vi.stubGlobal('fetch', async (url: URL) => {
        const path = url.pathname.replace('/map/lombard/', ''); requested.push(path);
        if (path === 'manifest.json') return Response.json(manifest);
        if (path === 'roads.json') return Response.json({ version: 1, nodes: [], edges: [{
          id: 'fixture-lane', from: 'a', to: 'b', lengthM: 40, speedMps: 8, lane: 0,
          points: [[lane.x, roadY, lane.z - 20], [lane.x, roadY, lane.z + 20]], bridge: roadY > 0, tunnel: roadY < 0,
        }] });
        const x = Number(path.split('/')[0]);
        if (!manifest.chunks.some(value => value.x === x)) return new Response(null, { status: 404 });
        if (path.endsWith('terrain.bin')) return new Response(Uint8Array.from(encodeHeightfield({
          size: 2, step: 256, offsetCm: 0, x, z: cz, values: new Uint16Array(4),
        })));
        if (path.endsWith('collision.json')) return Response.json({ version: 1, origin: [x * 256, 0, cz * 256], buildings: [] });
        return new Response(new ArrayBuffer(0));
      });
      const world = (await loadLombardWorld({ mountGeometry: () => () => {}, enabled: true, position: target, snapToRoad: explicit }))!;
      worlds.push(world);
      const snapped = explicit || !rawPresent;
      expect(requested.find(path => path.endsWith('mesh.glb'))).toBe(`${snapped ? laneX : rawX}/mesh.glb`);
      expect(world.spawn.x).toBeCloseTo(snapped ? lane.x : target.x);
      expect(world.spawn.y).toBe(snapped ? roadY : 0);
      const arrival = await snapSpawn(world, { place: FERRY, explicit });
      expect(arrival.x).toBeCloseTo(snapped ? lane.x : target.x);
      expect(arrival.y).toBe(snapped ? roadY : 0);
      expect(arrival.yaw).toBeCloseTo(headingToYaw(FERRY.heading));
      expect(world.collides(arrival.x, arrival.y, arrival.z)).toBe(false);
      expect(world.stats.errors).toEqual([]);
      world.dispose();
    }
  } finally {
    for (const world of worlds) world.dispose();
    vi.unstubAllGlobals();
  }
});
