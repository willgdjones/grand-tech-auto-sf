import { defineConfig } from 'vitest/config';
import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { fileURLToPath } from 'node:url';

// Playful Mayhem server-sync native smoke (gtasf-mayhem-sync-4fez): playfulMayhem on, worldCapacity
// off so the MAYHEM_FIRE relay is exercised over real sockets without the admission-grant flow.
export default defineConfig({
  resolve: { alias: { '@gtasf/shared/flags': fileURLToPath(new URL('./mayhem-test-flags.ts', import.meta.url)) } },
  plugins: [cloudflareTest({ main: './worker/src/world/test-worker.ts', miniflare: {
    compatibilityDate: '2026-09-28', compatibilityFlags: ['nodejs_compat'],
    durableObjects: { WORLD: { className: 'WorldDO', useSQLite: true } },
  } })],
  test: { include: ['worker/src/world/mayhem.do.ts'], maxWorkers: 1, testTimeout: 15000, hookTimeout: 15000 },
});
