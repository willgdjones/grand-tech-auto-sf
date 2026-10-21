import { defineConfig } from 'vitest/config';
import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { fileURLToPath } from 'node:url';

// Appearance persistence (resume) + cross-zone observer looks smoke (gtasf-apsync2).
export default defineConfig({
  resolve: { alias: { '@gtasf/shared/flags': fileURLToPath(new URL('./looksPersist-test-flags.ts', import.meta.url)) } },
  plugins: [cloudflareTest({ main: './worker/src/world/test-worker.ts', miniflare: {
    compatibilityDate: '2026-09-28', compatibilityFlags: ['nodejs_compat'],
    durableObjects: { WORLD: { className: 'WorldDO', useSQLite: true } },
  } })],
  test: { include: ['worker/src/world/looksPersist.do.ts'], maxWorkers: 1, testTimeout: 20000, hookTimeout: 20000 },
});
