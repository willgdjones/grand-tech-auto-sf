// Production builds swap the reviewed flags in ONLY for the exact specifier '@gtasf/shared/flags' (worker
// wrangler alias + web/vite.staging.config.ts). A relative import ('./flags', '../../shared/flags') bypasses
// the alias and silently reads the source defaults, which is how prod ran economy-v3 with v2 event bases,
// ladder, drop and Orientation cheques (#5.16 "$500k" label). Test-only flag bases are exempt.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { expect, it } from 'vitest';

const root = new URL('..', import.meta.url).pathname;
function* sources(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.') || name === 'dist' || name === 'dist-production') continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* sources(path);
    else if (/\.(ts|mts)$/.test(name) && !/\.test\.ts$/.test(name) && !/(test-flags|\.flags)\.ts$/.test(name)) yield path;
  }
}
it('every runtime import of the feature flags uses the aliased @gtasf/shared/flags specifier', () => {
  const offenders: string[] = [];
  for (const workspace of ['shared', 'web/src', 'worker/src']) for (const file of sources(join(root, workspace))) {
    if (file.endsWith('shared/flags.ts')) continue;
    if (/from\s+'(\.{1,2}\/)+(shared\/)?flags'/.test(readFileSync(file, 'utf8'))) offenders.push(relative(root, file));
  }
  expect(offenders).toEqual([]);
});
