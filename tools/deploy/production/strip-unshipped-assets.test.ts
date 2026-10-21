import { describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { REALISTIC_ONLY, dirBytes, stripUnshipped } from './strip-unshipped-assets';

describe('strip-unshipped-assets (gtasf-zzpr)', () => {
  it('drift guard: every stripped dir still exists and is non-empty in web/public', async () => {
    // If an asset dir is renamed/moved, the strip list goes stale and the ~24.6 MB saving silently
    // regresses into the payload. This fails loudly so the strip list is kept accurate.
    for (const rel of REALISTIC_ONLY) {
      const path = join('web/public', rel);
      expect((await stat(path)).isDirectory(), rel).toBe(true);
      expect(await dirBytes(path), rel).toBeGreaterThan(0);
    }
  });

  it('strips when realisticRender is off, previews with --dry, and no-ops when it ships', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'strip-'));
    try {
      for (const rel of REALISTIC_ONLY) {
        await mkdir(join(dir, rel), { recursive: true });
        await writeFile(join(dir, rel, 'x.glb'), Buffer.alloc(1000));
      }
      // realisticRender ships -> keep everything.
      const kept = await stripUnshipped({ buildDir: dir, shipRealistic: true });
      expect(kept.skipped).toBe(true);
      for (const rel of REALISTIC_ONLY) expect((await stat(join(dir, rel))).isDirectory()).toBe(true);
      // off + dry -> measures but keeps.
      const dryRun = await stripUnshipped({ buildDir: dir, dry: true, shipRealistic: false });
      expect(dryRun.skipped).toBe(false);
      expect(dryRun.removed.length).toBe(REALISTIC_ONLY.length);
      expect(dryRun.freed).toBe(REALISTIC_ONLY.length * 1000);
      for (const rel of REALISTIC_ONLY) expect((await stat(join(dir, rel))).isDirectory()).toBe(true);
      // off + real -> removes them.
      const real = await stripUnshipped({ buildDir: dir, shipRealistic: false });
      expect(real.freed).toBe(REALISTIC_ONLY.length * 1000);
      for (const rel of REALISTIC_ONLY) await expect(stat(join(dir, rel))).rejects.toThrow();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('is a no-op on a build dir that has none of the assets', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'strip-empty-'));
    try {
      const result = await stripUnshipped({ buildDir: dir, shipRealistic: false });
      expect(result.removed).toEqual([]);
      expect(result.freed).toBe(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
