import { defineConfig } from 'vitest/config';
import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: { alias: { '@gtasf/shared/flags': fileURLToPath(new URL('./admission/test-flags.ts', import.meta.url)) } },
  plugins: [cloudflareTest({ main: './worker/src/world/admission-worker.ts', miniflare: {
    compatibilityDate: '2026-09-28', compatibilityFlags: ['nodejs_compat'],
    durableObjects: { WORLD: { className: 'WorldDO', useSQLite: true }, LOBBY: { className: 'LobbyDO', useSQLite: true } },
    d1Databases: ['DB'], bindings: { WORLD_CAPACITY: '1', LAUNCH_MODE: 'invite', INVITE_CODE: 'native-smoke-invite' },
  } })],
  test: { include: ['worker/src/world/admission.do.ts'], maxWorkers: 1, testTimeout: 15000, hookTimeout: 15000 },
});
