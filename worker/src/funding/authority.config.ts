import { defineConfig } from 'vitest/config';
import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
const migrations = ['0001_initial.sql', '0002_events.sql', '0010_funding.sql', '0014_funding_bonus.sql'].map(name => readFileSync(new URL(`../../migrations/${name}`, import.meta.url), 'utf8'));
export default defineConfig({
  resolve: { alias: { '@gtasf/shared/flags': fileURLToPath(new URL('./authority.flags.ts', import.meta.url)) } },
  plugins: [cloudflareTest({ main: './worker/src/funding/test-worker.ts', miniflare: {
    compatibilityDate: '2026-09-28', compatibilityFlags: ['nodejs_compat'],
    durableObjects: { WORLD: { className: 'WorldDO', useSQLite: true } }, d1Databases: ['DB'],
    bindings: { LAUNCH_MODE: 'open', FUNDING_MIGRATIONS: JSON.stringify(migrations) },
  } })],
  test: { include: ['worker/src/funding/authority.do.ts'], maxWorkers: 1, testTimeout: 45000, hookTimeout: 15000 },
});
