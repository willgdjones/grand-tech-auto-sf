import { afterEach, expect, it, vi } from 'vitest';
import { loadLombardWorld } from './world';
import { encodeHeightTransport, encodeRoadTransport } from '@gtasf/shared/mapTransport';
import { encodeMapCollision } from '@gtasf/shared/mapCollision';
import { packRoadGraph } from '../../../../tools/map/src/pipeline/roadPack';

const compact = vi.hoisted(() => ({ enabled: false }));
vi.mock('@gtasf/shared/flags', async importOriginal => {
  const actual = await importOriginal<typeof import('@gtasf/shared/flags')>();
  return { ...actual, flags: { ...actual.flags, get compactMapAssets() { return compact.enabled; } } };
});

vi.mock('three/addons/loaders/GLTFLoader.js', async () => {
  const { Group } = await import('three');
  return { GLTFLoader: class {
    setMeshoptDecoder() { return this; }
    async parseAsync() { return { scene: new Group() }; }
  } };
});

it('restores compact graph, contact and courtyard collision behind the paired opt-in flag', async () => {
  vi.stubGlobal('location', { href: 'http://localhost/' }); vi.stubGlobal('document', { visibilityState: 'visible' });
  vi.stubGlobal('requestAnimationFrame', (callback: () => void) => setTimeout(callback, 0));
  const height = new Uint8Array(terrain()), graph = packRoadGraph({ version: 1, nodes: [], edges: [], warnings: [] });
  const collision = new TextEncoder().encode(JSON.stringify({ version: 1, origin: [0, 0, 0], buildings: [{
    id: 'source:retained-courtyard', minY: 1, maxY: 7, heightSource: 'datasf',
    rings: [[[20, 20], [40, 20], [40, 40], [20, 40]], [[26, 26], [34, 26], [34, 34], [26, 34]]],
  }] }) + '\n');
  const metadata = async (bytes: Uint8Array) => ({ transport: 'predictive-v1', decodedBytes: bytes.length,
    decodedSha256: [...new Uint8Array(await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes).buffer))].map(v => v.toString(16).padStart(2, '0')).join('') });
  const manifest = { version: 1, chunkSize: 256, requiredFeatures: ['compactMapAssets'],
    roadGraph: { path: 'roadgraph.bin', encoding: 'roadpack-v1', ...await metadata(graph) },
    chunks: [{ id: '0_0', x: 0, z: 0, lods: [{ path: 'lod0.glb' }, { path: 'lod1.glb' }],
      terrain: { path: 'terrain.bin', ...await metadata(height) }, collision: { path: 'collision.bin', ...await metadata(collision) } }] };
  vi.stubGlobal('fetch', vi.fn(async (url: URL) => {
    if (url.pathname.endsWith('manifest.json')) return Response.json(manifest);
    if (url.pathname.endsWith('roadgraph.bin')) return new Response(encodeRoadTransport(graph));
    if (url.pathname.endsWith('terrain.bin')) return new Response(encodeHeightTransport(height));
    if (url.pathname.endsWith('collision.bin')) return new Response(encodeMapCollision(collision));
    return new Response(new ArrayBuffer(0));
  }));
  const options = { enabled: true, position: { x: 10, z: 10 }, mountGeometry: () => () => {} };
  try {
    await expect(loadLombardWorld(options)).rejects.toThrow('COMPACT_MAP_ASSETS_DISABLED');
    compact.enabled = true;
    const world = (await loadLombardWorld(options))!;
    expect(world.heightAt(10, 10)).toBe(3); expect(world.routingGraph?.edges).toEqual([]);
    expect(world.collides(22, 3, 22)).toBe(true); expect(world.collides(30, 3, 30)).toBe(false);
    expect(world.collides(22, 10, 22)).toBe(false); world.dispose();
  } finally { compact.enabled = false; }
});
vi.mock('three/addons/libs/meshopt_decoder.module.js', () => ({ MeshoptDecoder: { useWorkers: vi.fn() } }));
afterEach(() => vi.unstubAllGlobals());

function terrain(x = 0) {
  const bytes = new ArrayBuffer(40), view = new DataView(bytes);
  view.setUint32(0, 0x47544846); view.setUint16(4, 1, true); view.setUint16(6, 2, true);
  view.setFloat32(8, 256, true); view.setInt32(12, 300, true); view.setInt32(16, x, true); view.setFloat32(24, .01, true);
  return bytes;
}

it('overlaps default target downloads, but preserves explicit road snapping, preset LOD and single requests', async () => {
  vi.stubGlobal('location', { href: 'http://localhost/' });
  vi.stubGlobal('document', { visibilityState: 'visible' });
  vi.stubGlobal('requestAnimationFrame', (callback: () => void) => setTimeout(callback, 0));
  for (const explicit of [false, true]) {
    let finishGraph!: (value: Response) => void;
    const graph = new Promise<Response>(resolve => { finishGraph = resolve; });
    const chunks = [0, 1].map(x => ({ id: `${x}_0`, x, z: 0,
      lods: [0, 1].map(lod => ({ path: `${x}/lod${lod}.glb`, bytes: 0 })),
      terrain: { path: `${x}/terrain.bin`, bytes: 40 }, collision: { path: `${x}/collision.json`, bytes: 0 } }));
    const paths: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: URL) => {
      const path = url.pathname.replace('/map/lombard/', ''); paths.push(path);
      if (path === 'manifest.json') return Response.json({ version: 1, chunkSize: 256, chunks,
        roadGraph: { path: 'graph.json' }, neighbourhoods: { path: 'names.json' } });
      if (path === 'graph.json') return graph;
      if (path === 'names.json') return Response.json({ version: 1, neighbourhoods: [] });
      if (path.endsWith('terrain.bin')) return new Response(terrain(Number(path[0])));
      if (path.endsWith('collision.json')) return Response.json({ version: 1, origin: [Number(path[0]) * 256, 0, 0], buildings: [] });
      return new Response(new ArrayBuffer(0));
    }));
    const mounting = vi.fn(() => () => {});
    const pending = loadLombardWorld({ enabled: true, tier: 'low', position: { x: 10, z: 10 }, snapToRoad: explicit, mountGeometry: mounting });
    await vi.waitFor(() => expect(paths).toContain('names.json'));
    expect(paths.filter(path => /^\d\//.test(path))).toEqual(explicit ? [] : ['0/lod1.glb', '0/terrain.bin', '0/collision.json']);
    expect(mounting).not.toHaveBeenCalled();
    finishGraph(Response.json({ version: 1, nodes: [], edges: [{ id: 'lane', from: 'a', to: 'b',
      lengthM: 40, speedMps: 10, lane: 0, points: [[300, 3, 0], [300, 3, 40]] }] }));
    const world = (await pending)!;
    expect(world.spawn.x).toBe(explicit ? 300 : 10);
    expect(world.surfaceHeightAt(world.spawn.x, world.spawn.z)).toBe(3);
    const target = explicit ? '1' : '0';
    expect(paths.filter(path => path === `${target}/lod1.glb`)).toHaveLength(1);
    expect(paths.some(path => path.endsWith('lod0.glb'))).toBe(false);
    world.dispose();
  }
});
