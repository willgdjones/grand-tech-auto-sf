import { defineConfig } from 'vitest/config';
import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { cityAnchorRoadBytes, cityAnchorRoadKey } from './city-anchors.fixture';

const migrations = ['0001_initial.sql', '0002_events.sql', '0010_funding.sql', '0014_funding_bonus.sql']
  .map(name => readFileSync(new URL(`../../migrations/${name}`, import.meta.url), 'utf8'));
export default defineConfig({
  resolve: { alias: { '@gtasf/shared/flags': fileURLToPath(new URL('./authority.flags.ts', import.meta.url)) } },
  plugins: [cloudflareTest({ main: './worker/src/funding/test-worker.ts', miniflare: {
    compatibilityDate: '2026-09-28', compatibilityFlags: ['nodejs_compat'],
    durableObjects: { WORLD: { className: 'WorldDO', useSQLite: true } }, d1Databases: ['DB'], r2Buckets: ['ASSETS'],
    bindings: { LAUNCH_MODE: 'open', FUNDING_MIGRATIONS: JSON.stringify(migrations),
      WORLD_ROAD_GRAPH_KEY: cityAnchorRoadKey,
      WORLD_ROAD_GRAPH_SHA256: createHash('sha256').update(cityAnchorRoadBytes).digest('hex') },
  } })],
  test: { include: ['worker/src/funding/city-anchors.do.ts'], maxWorkers: 1, testTimeout: 15000, hookTimeout: 10000 },
});
