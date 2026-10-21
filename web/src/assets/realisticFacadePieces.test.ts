import { describe, expect, it } from 'vitest';
import { realisticFacadePieces, type RealisticFacadePiece } from './realisticFacadePieces';

// Guards the Meshy hero-piece manifest + the loader contract (gtasf-realistic-facade-meshy-pieces-xyrw,
// gtasf-facade-meshy-buildingdetail-swap-13c6). The pieces ship flag-off, so a manifest/loader mismatch
// (a referenced kind missing, or a malformed GLB url/bounds) would otherwise surface only when pane 6
// flips storefrontPieces — this catches it at `npx vitest`. These are the kinds the runtime loaders
// reference: buildingDetail.ts (MESHY_KINDS) + props/facadeStorefronts.ts.
const REQUIRED_KINDS = ['bay-window', 'awning', 'balcony', 'cornice', 'fire-escape', 'storefront', 'entrance'] as const;

function expectValidFile(file: RealisticFacadePiece['hd'], label: string) {
  expect(typeof file.url, label).toBe('string');
  expect(file.url, label).toMatch(/^\/assets\/facades-pbr\/[a-z0-9.-]+\.glb$/);
  expect(Number.isInteger(file.triangles) && file.triangles > 0, label).toBe(true);
  expect(Number.isInteger(file.bytes) && file.bytes > 0, label).toBe(true);
  expect(file.sha256, label).toMatch(/^[a-f0-9]{64}$/);
}

describe('realisticFacadePieces manifest', () => {
  it('contains every kind the runtime loaders reference', () => {
    for (const kind of REQUIRED_KINDS) expect(realisticFacadePieces[kind], `missing manifest kind: ${kind}`).toBeDefined();
  });

  it('every piece has valid HD + Low GLB files (url/triangles/bytes/sha)', () => {
    for (const [kind, piece] of Object.entries(realisticFacadePieces)) {
      expectValidFile(piece.hd, `${kind}.hd`);
      expectValidFile(piece.low, `${kind}.low`);
      // Low LOD must be lighter than HD (the loaders use .low for in-world instancing).
      expect(piece.low.triangles, `${kind}: low <= hd triangles`).toBeLessThanOrEqual(piece.hd.triangles);
    }
  });

  it('every piece has finite 3-component bounds with max >= min and a non-zero width', () => {
    for (const [kind, piece] of Object.entries(realisticFacadePieces)) {
      const { min, max } = piece.bounds;
      expect(min.length, `${kind} bounds.min`).toBe(3);
      expect(max.length, `${kind} bounds.max`).toBe(3);
      expect(min.every(Number.isFinite) && max.every(Number.isFinite), `${kind} bounds finite`).toBe(true);
      for (let i = 0; i < 3; i++) expect(max[i]!, `${kind} bounds max>=min axis ${i}`).toBeGreaterThanOrEqual(min[i]!);
      // nativeWidth = max[0]-min[0] drives the loaders' scale; a zero width would divide-by-zero / blow up.
      expect(max[0]! - min[0]!, `${kind} non-zero width`).toBeGreaterThan(0);
    }
  });

  it('declares its Meshy paid-plan provenance (not CC0) on every piece', () => {
    for (const [kind, piece] of Object.entries(realisticFacadePieces)) {
      expect(piece.license, `${kind} license`).toMatch(/Meshy/i);
      expect(typeof piece.meshyJob, `${kind} meshyJob`).toBe('string');
    }
  });
});
