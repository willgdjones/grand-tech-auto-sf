import { expect, it } from 'vitest';
import { createProceduralEnvironment } from './proceduralEnv';

// GL-free smoke: PMREMGenerator's constructor and the gradient scene/material
// build on the CPU, so we can confirm the module constructs, exposes its API and
// disposes cleanly without a WebGL context. The PMREM render in update() needs a
// real GL context, so pane 6 verifies the look (reflective glass/chrome) in-browser.
it('constructs a procedural-environment handle and disposes without a GL context', () => {
  const env = createProceduralEnvironment({} as never);
  expect(env.texture).toBeNull();
  expect(typeof env.update).toBe('function');
  expect(() => env.dispose()).not.toThrow();
});
