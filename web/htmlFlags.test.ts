import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { flagIsOn } from './htmlFlags';

it('reads a flag from both the dev flags.ts and the generated reviewed-flags JSON module', () => {
  expect(flagIsOn('  loadingHook: true,\n', 'loadingHook')).toBe(true);
  expect(flagIsOn('  loadingHook: false,\n', 'loadingHook')).toBe(false);
  expect(flagIsOn('export const flags = Object.freeze({\n  "loadingHook": true,\n', 'loadingHook')).toBe(true);
  expect(flagIsOn('{ "otherloadingHook": true }', 'loadingHook')).toBe(false);
  expect(flagIsOn('{}', 'loadingHook')).toBe(false); // absent (prod set without it) = off
  // The placeholder index.html carries must be the one the plugin replaces.
  expect(readFileSync(new URL('./index.html', import.meta.url), 'utf8')).toContain('data-loading-hook="%FLAG_LOADINGHOOK%"');
});
