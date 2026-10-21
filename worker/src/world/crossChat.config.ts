import { defineConfig } from 'vitest/config';
import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { fileURLToPath } from 'node:url';

// Cross-border chat native smoke: a test-only flags alias turns zonedWorld + chat on (worldCapacity off)
// without touching shared/dev flags, mirroring zoned.config.ts / characterLooks.config.ts.
export default defineConfig({
  resolve: { alias: { '@gtasf/shared/flags': fileURLToPath(new URL('./crossChat-test-flags.ts', import.meta.url)) } },
  plugins: [cloudflareTest({ main: './worker/src/world/test-worker.ts', miniflare: {
    compatibilityDate: '2026-09-28', compatibilityFlags: ['nodejs_compat'],
    durableObjects: { WORLD: { className: 'WorldDO', useSQLite: true } },
  } })],
  test: { include: ['worker/src/world/crossChat.do.ts'], maxWorkers: 1, testTimeout: 20000, hookTimeout: 20000 },
});
