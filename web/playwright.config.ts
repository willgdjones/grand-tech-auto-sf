import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  testDir: './tests', testMatch: '**/*.spec.ts', workers: 1, fullyParallel: false, retries: 0,
  timeout: 45_000, expect: { timeout: 10_000 }, outputDir: '../artifacts/input-harness',
  use: { baseURL: process.env.GTASF_TEST_URL ?? 'http://127.0.0.1:4173', headless: true },
  webServer: process.env.GTASF_TEST_URL ? undefined : {
    command: 'node web/tests/preview.mjs', cwd: fileURLToPath(new URL('../', import.meta.url)),
    url: 'http://127.0.0.1:4173/api/health',
    reuseExistingServer: false, timeout: 30_000,
  },
});
