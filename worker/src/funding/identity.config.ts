import { defineConfig } from 'vitest/config';
import authority from './authority.config';
export default defineConfig({ ...authority,
  test: { ...authority.test, include: ['worker/src/funding/identity.do.ts'], testTimeout: 20000 },
});
