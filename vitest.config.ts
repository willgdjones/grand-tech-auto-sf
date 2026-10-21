import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['{shared,web,worker,tools}/**/*.test.ts'], exclude: ['**/node_modules/**', '**/.wrangler/**', '**/out/**'], maxWorkers: 1 } });
