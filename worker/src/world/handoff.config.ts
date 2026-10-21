import { defineConfig } from 'vitest/config';
import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { fileURLToPath } from 'node:url';

// Seamless-handoff native smoke (gtasf-djjz): reuses the zoned flags alias (zonedWorld on, worldCapacity
// off) so /internal/handoff/receive is live and resume preserves a transferred id.
export default defineConfig({
  resolve: { alias: { '@gtasf/shared/flags': fileURLToPath(new URL('./zoned-test-flags.ts', import.meta.url)) } },
  plugins: [cloudflareTest({ main: './worker/src/world/test-worker.ts', miniflare: {
    compatibilityDate: '2026-09-28', compatibilityFlags: ['nodejs_compat'],
    durableObjects: { WORLD: { className: 'WorldDO', useSQLite: true } },
  } })],
  test: { include: ['worker/src/world/handoff.do.ts'], maxWorkers: 1, testTimeout: 15000, hookTimeout: 15000 },
});
