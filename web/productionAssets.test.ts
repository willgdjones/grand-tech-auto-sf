import { expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { build } from 'vite';
import { runtimeAssetsOnly } from './productionAssets';

it('ships assets according to the compiled flag alias and retains packs for unknown/dynamic flags', async () => {
  const root = await mkdtemp(join(tmpdir(), 'gtasf-asset-build-'));
  try {
    await mkdir(join(root, 'src'));
    await writeFile(join(root, 'index.html'), '<script type="module" src="/src/main.ts"></script>');
    await writeFile(join(root, 'src/main.ts'), "import { flags } from '@gtasf/shared/flags'; console.log(flags);");
    const assets = ['art/facades-pbr/src/master.png', 'art/facades-pbr/albedo.jpg', 'assets/vehicles-pbr/car.glb', 'assets/facades-pbr/store.glb'];
    for (const path of assets) { await mkdir(join(root, 'public', path, '..'), { recursive: true }); await writeFile(join(root, 'public', path), path); }
    const flagsFile = join(root, 'reviewed-flags.ts');
    const variants = [
      { source: 'Object.freeze({ realisticRender: false, realisticFacades: false, storefrontPieces: true })', expected: [false, false, false, false] },
      { source: 'Object.freeze({ realisticRender: true, realisticFacades: true, storefrontPieces: true })', expected: [false, true, true, true] },
      { source: 'Object.freeze({ realisticRender: false, realisticFacades: true, storefrontPieces: true })', expected: [false, false, false, true] },
      { source: 'Object.freeze({ realisticRender: false, ...globalThis })', expected: [false, true, true, true] },
    ];
    for (const [i, variant] of variants.entries()) {
      await writeFile(flagsFile, `export const flags = ${variant.source};`);
      const output = join(root, `dist-${i}`);
      await build({ root, configFile: false, logLevel: 'silent', plugins: [runtimeAssetsOnly()],
        resolve: { alias: { '@gtasf/shared/flags': flagsFile } }, build: { outDir: output, minify: false } });
      for (const [index, path] of assets.entries()) {
        expect(await readFile(join(output, path)).then(() => true, () => false)).toBe(variant.expected[index]);
        expect(await readFile(join(root, 'public', path), 'utf8')).toBe(path);
      }
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});
