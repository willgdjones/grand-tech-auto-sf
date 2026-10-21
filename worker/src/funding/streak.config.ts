import { defineConfig } from 'vitest/config';
import authority from './authority.config';

// Reuse the native WorldDO/D1 fixture, selecting only the missing sequential-award check.
export default defineConfig({ ...authority,
  test: { ...authority.test, include: ['worker/src/funding/streak.do.ts'], testTimeout: 65_000 },
});
