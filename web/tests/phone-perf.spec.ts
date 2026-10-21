import { expect, test } from '@playwright/test';
import { frameStats } from '../src/testing/core';

test.use({ viewport: { width: 1080, height: 2400 }, deviceScaleFactor: 2.75, isMobile: true, hasTouch: true });
test('phone low preset: 4x CPU, real warmup, >=60 fps mean and <=25 ms p95', async ({ page }, info) => {
  const errors: string[] = [], markers: string[] = [];
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text());
    if (/^(READY|TEST_(PASSED|FAILED):)/.test(message.text())) markers.push(message.text());
  });
  page.on('pageerror', error => errors.push(error.message));
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  try {
    await page.goto('/?test=phone-perf&perf=1&preset=low');
    await page.waitForFunction(() => window.__gtasf?.ready);
    await page.waitForFunction(() => ['passed', 'failed'].includes(window.__gtasf?.status ?? ''), null, { timeout: 35_000 });
    const evidence = await page.evaluate(() => ({
      status: window.__gtasf!.status, detail: window.__gtasf!.detail,
      capture: window.__gtasf!.capture, warmupMs: window.__gtasf!.perf.warmupMs,
      samples: [...window.__gtasf!.perf.samples], errors: [...window.__gtasf!.errors],
      preset: new URLSearchParams(location.search).get('preset'),
      dpr: devicePixelRatio, viewport: { width: innerWidth, height: innerHeight },
      canvas: { width: document.querySelector('canvas')?.width, height: document.querySelector('canvas')?.height },
    }));
    await info.attach('phone-performance.json', { body: JSON.stringify({ ...evidence, cpuThrottle: 4, markers, consoleErrors: errors }, null, 2), contentType: 'application/json' });
    expect(errors).toEqual([]); expect(evidence.errors).toEqual([]);
    expect(markers).toContain('READY'); expect(evidence.capture).toBe(false);
    expect(evidence.preset).toBe('low'); expect(evidence.warmupMs).toBe(2000);
    expect(evidence.dpr).toBe(2.75); expect(evidence.viewport).toEqual({ width: 1080, height: 2400 });
    expect(evidence.samples.length).toBeGreaterThanOrEqual(60);
    const stats = frameStats(evidence.samples);
    console.log('PHONE_PERF', JSON.stringify(stats));
    expect(stats.meanFps, JSON.stringify(stats)).toBeGreaterThanOrEqual(60);
    expect(stats.p95Ms, JSON.stringify(stats)).toBeLessThanOrEqual(25);
    expect(evidence.status, evidence.detail).toBe('passed');
    expect(markers).toContain('TEST_PASSED:phone-perf');
  } finally { await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 }); await cdp.detach(); }
});
