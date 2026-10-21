import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { realisticVehicleAssets } from './realisticVehicles';
import { realisticFacadePieces } from './realisticFacadePieces';

/**
 * Guards the Meshy manifests against drift (gtasf-u9n0 / gtasf-realistic-facade-meshy-pieces-xyrw):
 * a regenerated, resized or deleted GLB that isn't rebuilt through tools/assets would silently break
 * the realisticRender path or blow the load budget. Every manifest entry must point at a real file
 * whose bytes + sha256 still match, with both LODs present and the phone Low under budget.
 */
const LOW_MAX_BYTES = 300_000;         // phones load only Low; one-time per asset.
const HD_MAX_BYTES = 2_000_000;        // sane per-file cap (AGENTS.md hard limit is 25 MB).

async function fileFor(url: string): Promise<Uint8Array> {
  // Manifest urls are site-absolute (/assets/...); resolve against web/public.
  return new Uint8Array(await readFile(new URL(`../../public${url}`, import.meta.url)));
}

function checkManifest(name: string, assets: Record<string, {
  hd: { url: string; triangles: number; bytes: number; sha256: string };
  low: { url: string; triangles: number; bytes: number; sha256: string };
  bounds: { min: readonly number[]; max: readonly number[] };
}>, hdTriBudget: number, lowTriBudget: number) {
  describe(`${name} manifest integrity`, () => {
    for (const [id, asset] of Object.entries(assets)) {
      it(`${id}: HD + Low files match the manifest and stay in budget`, async () => {
        for (const [tier, file, triBudget, byteBudget] of [
          ['hd', asset.hd, hdTriBudget, HD_MAX_BYTES],
          ['low', asset.low, lowTriBudget, LOW_MAX_BYTES],
        ] as const) {
          const bytes = await fileFor(file.url);
          expect(bytes.byteLength, `${id} ${tier} bytes`).toBe(file.bytes);
          expect(bytes.byteLength, `${id} ${tier} <= budget`).toBeLessThanOrEqual(byteBudget);
          expect(createHash('sha256').update(bytes).digest('hex'), `${id} ${tier} sha256`).toBe(file.sha256);
          expect(file.triangles, `${id} ${tier} tris`).toBeLessThanOrEqual(triBudget);
        }
        // Bounds: non-degenerate, grounded (min Y ~0) for both fleets.
        expect(asset.bounds.max[1]! - asset.bounds.min[1]!, `${id} height`).toBeGreaterThan(0);
        expect(Math.abs(asset.bounds.min[1]!), `${id} base on ground`).toBeLessThan(0.05);
      });
    }
  });
}

checkManifest('realistic vehicles', realisticVehicleAssets, 30_000, 5_000);
checkManifest('realistic facade pieces', realisticFacadePieces, 14_000, 3_000);
