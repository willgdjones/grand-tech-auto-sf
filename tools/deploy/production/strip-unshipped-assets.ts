/**
 * Strip realisticRender-only Meshy assets from a production web build when realisticRender does NOT
 * ship (gtasf-zzpr total-payload budget). The vehicles-pbr + facades-pbr + art/facades-pbr dirs
 * (~24.6 MB of GLBs/atlases) are only fetched when flags.realisticRender is on; while it is off they
 * are dead weight copied verbatim from web/public into the build. This removes them so they do not
 * count against the 80 MB total payload gate. No-op (keeps everything) when realisticRender ships —
 * then the deploy carries them.
 *
 *   tsx tools/deploy/production/strip-unshipped-assets.ts [buildDir=web/dist-production] [--dry]
 *
 * Wiring (deploy pane): call this after build-web.mjs, before deploy.mjs packages dist-production.
 */
import { rm, stat, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { flags } from '../../../shared/flags';

// Dirs only fetched under realisticRender (realisticFacades requires realisticRender too), so they
// are dead weight whenever realisticRender is off. Verified: the ps2 facade path loads /art/facades/
// + /art/manifest.json (facadeAtlas.ts), NOT /art/facades-pbr/ — that PBR atlas is read only by the
// realistic path (realisticFacadeAtlas.ts), so stripping it here is safe while realisticRender is off.
export const REALISTIC_ONLY = ['assets/vehicles-pbr', 'assets/facades-pbr', 'art/facades-pbr'];

export async function dirBytes(path: string): Promise<number> {
  let total = 0;
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const child = join(path, entry.name);
    total += entry.isDirectory() ? await dirBytes(child) : (await stat(child)).size;
  }
  return total;
}

/** Remove (or, with dry, just measure) the realisticRender-only dirs from buildDir. No-op when realisticRender ships. */
export async function stripUnshipped(options: { buildDir?: string; dry?: boolean; shipRealistic?: boolean } = {}):
  Promise<{ freed: number; removed: string[]; skipped: boolean }> {
  const { buildDir = 'web/dist-production', dry = false, shipRealistic = flags.realisticRender } = options;
  if (shipRealistic) return { freed: 0, removed: [], skipped: true };
  let freed = 0;
  const removed: string[] = [];
  for (const rel of REALISTIC_ONLY) {
    const path = join(buildDir, rel);
    try { await stat(path); } catch { continue; } // not present in this build
    const bytes = await dirBytes(path);
    freed += bytes;
    removed.push(`${rel} (${(bytes / 1_048_576).toFixed(2)} MB)`);
    if (!dry) await rm(path, { recursive: true, force: true });
  }
  return { freed, removed, skipped: false };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const dry = args.includes('--dry');
  const buildDir = args.find(a => !a.startsWith('--')) ?? 'web/dist-production';
  const result = await stripUnshipped({ buildDir, dry });
  if (result.skipped) console.log('realisticRender ships — keeping all assets (no strip).');
  else console.log(`${dry ? '[dry] would strip' : 'stripped'} realisticRender-only assets from ${buildDir}: ${result.removed.join(', ') || '(none present)'} — ${(result.freed / 1_048_576).toFixed(2)} MB ${dry ? 'saveable' : 'removed'}.`);
}
