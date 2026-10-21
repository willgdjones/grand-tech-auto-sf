import { defineConfig } from 'vitest/config';
import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { fileURLToPath } from 'node:url';

// Zoned-world native smoke: a test-only flags alias flips zonedWorld on (worldCapacity off)
// without touching the shared/dev flags, mirroring admission.config.ts.
export default defineConfig({
  resolve: { alias: { '@gtasf/shared/flags': fileURLToPath(new URL('./zoned-test-flags.ts', import.meta.url)) } },
  plugins: [cloudflareTest({ main: './worker/src/world/test-worker.ts', miniflare: {
    compatibilityDate: '2026-09-28', compatibilityFlags: ['nodejs_compat'],
    durableObjects: { WORLD: { className: 'WorldDO', useSQLite: true } },
  } })],
  test: { include: ['worker/src/world/zoned.do.ts'], maxWorkers: 1, testTimeout: 15000, hookTimeout: 15000 },
});
