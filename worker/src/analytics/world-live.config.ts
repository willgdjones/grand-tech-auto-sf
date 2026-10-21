import { defineConfig } from 'vitest/config';
import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  resolve: { alias: { '@gtasf/shared/flags': fileURLToPath(new URL('./world-live.flags.ts', import.meta.url)) } },
  plugins: [cloudflareTest({ main: './worker/src/world/test-worker.ts', miniflare: {
    compatibilityDate: '2026-09-28', compatibilityFlags: ['nodejs_compat'],
    durableObjects: { WORLD: { className: 'WorldDO', useSQLite: true } },
    bindings: { ENVIRONMENT: 'test', LAUNCH_MODE: 'open', POSTHOG_KEY: 'phc_offline_fixture',
      X_PIXEL_ID: 'rgc75', X_PIXEL_TOKEN: 'offline_fixture_only', X_EVENT_PLAY_START: 'tw-rgc75-rgc7f' },
  } })],
  test: { include: ['worker/src/analytics/world-live.do.ts'], maxWorkers: 1, testTimeout: 15000, hookTimeout: 15000 },
});
