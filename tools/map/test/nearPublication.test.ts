import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { digest } from '../src/pipeline/sources';
import { patchManifestWithNear, prepareNearPublication } from '../src/pack/nearPublication';

const sha = (c: string) => c.repeat(64);
const live = { version: 1, area: 'sf', roadGraph: { path: `/map/releases/${sha('a')}/roadgraph.bin`, bytes: 10, gzipBytes: 5, sha256: sha('b') }, release: sha('a') } as never;

async function bake(sourceSha256 = sha('b')) {
  const root = await mkdtemp(join(tmpdir(), 'gtasf-near-pub-'));
  const files: Record<string, Buffer> = { 'roadgraph-near.bin': Buffer.from('near graph bytes'), 'roadgraph-near-ferry_building.bin': Buffer.from('ferry part') };
  const artifact = (path: string) => ({ path, bytes: files[path]!.length, gzipBytes: gzipSync(files[path]!).length, sha256: digest(files[path]!), encoding: 'roadpack-v1' as const });
  for (const [path, raw] of Object.entries(files)) { await writeFile(join(root, path), raw); await writeFile(join(root, `${path}.gz`), gzipSync(raw)); }
  const near = { ...artifact('roadgraph-near.bin'), sourceSha256, coverage: [{ id: 'ferry-building', x: 0, z: 0, radiusM: 1500 }],
    parts: [{ ...artifact('roadgraph-near-ferry_building.bin'), id: 'ferry-building' }] };
  await writeFile(join(root, 'manifest.json'), JSON.stringify({ version: 1, roadGraph: { sha256: sha('b') }, roadGraphNear: near }));
  return { root, near };
}

describe('near-graph-only publication (gtasf-0k01)', () => {
  it('patches the live manifest with release-independent, content-addressed near paths', async () => {
    const { near } = await bake();
    const patched = patchManifestWithNear(live, near as never, `/map/near/${near.sha256}`)!;
    expect(patched.roadGraph).toEqual((live as { roadGraph: unknown }).roadGraph); // full graph untouched
    expect(patched.roadGraphNear!.path).toBe(`/map/near/${near.sha256}/roadgraph-near.bin`);
    expect(patched.roadGraphNear!.parts![0]!.path).toBe(`/map/near/${near.sha256}/roadgraph-near-ferry_building.bin`);
    expect(patchManifestWithNear(patched, near as never, `/map/near/${near.sha256}`)).toBeNull(); // already live: no-op
  });

  it('refuses a near graph cut from a different full graph than the one live', async () => {
    const { near } = await bake(sha('c'));
    expect(() => patchManifestWithNear(live, near as never, `/map/near/${near.sha256}`)).toThrow(/publish the full map/);
  });

  it('plans verified near objects first and the alias manifest last; rejects a corrupt gzip sibling', async () => {
    const { root, near } = await bake(), out = await mkdtemp(join(tmpdir(), 'gtasf-near-out-'));
    const plan = (await prepareNearPublication(root, Buffer.from(JSON.stringify(live)), 'lombard', out))!;
    expect(plan.objects.map(o => o.key)).toEqual([
      `map/near/${near.sha256}/roadgraph-near.bin`, `map/near/${near.sha256}/roadgraph-near-ferry_building.bin`, 'map/lombard/manifest.json']);
    expect(plan.objects.at(-1)!.cacheControl).toBe('public, max-age=0, must-revalidate');
    const uploaded = JSON.parse(gunzipSync(await readFile(plan.objects.at(-1)!.file)).toString());
    expect(uploaded.roadGraphNear.sha256).toBe(near.sha256);
    await writeFile(join(root, 'roadgraph-near.bin.gz'), gzipSync(Buffer.from('tampered')));
    await expect(prepareNearPublication(root, Buffer.from(JSON.stringify(live)), 'lombard', out)).rejects.toThrow(/Corrupt/);
  });
});
