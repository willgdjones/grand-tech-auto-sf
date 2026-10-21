import { describe, expect, it } from 'vitest';
import { FrameSampler, frameStats } from './core';
describe('wall-frame performance evidence', () => {
  it('uses two seconds of real warmup and preserves stalls without clamping', () => {
    const s = new FrameSampler(100);
    for (const now of [100, 1000, 2090, 2110, 2126, 2246]) s.observe(now);
    expect(s.samples).toEqual([16, 120]);
    expect(frameStats(s.samples)).toMatchObject({ count: 2, meanMs: 68, p95Ms: 120, maxMs: 120 });
  });
  it('reports reciprocal mean frame time and nearest-rank p95', () => {
    const samples = [...Array<number>(95).fill(10), ...Array<number>(5).fill(30)];
    expect(frameStats(samples)).toMatchObject({ count: 100, meanMs: 11, meanFps: 1000 / 11, p95Ms: 10, maxMs: 30 });
    expect(() => frameStats([])).toThrow();
    expect(() => frameStats([NaN])).toThrow();
  });
});
