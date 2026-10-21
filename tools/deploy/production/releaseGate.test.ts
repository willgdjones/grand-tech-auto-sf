import { describe, expect, it } from 'vitest';
// @ts-expect-error — plain-JS deploy helper
import { releaseChunks, waitForReleaseChunks } from './releaseGate.mjs';

const html = (js: string, css: string) => `<link rel="stylesheet" href="/assets/${css}"><script type="module" src="/assets/${js}"></script><img src="/art/x.webp">`;
const NEW = html('game-NEW.js', 'game-NEW.css'), OLD = html('game-OLD.js', 'game-OLD.css');

function fakeWorld(timeline: { at: number; index: string; status: Record<string, number>; host?: string }[]) {
  let t = 0;
  const urls: string[] = [];
  const current = (host: string) => [...timeline].reverse().find(e => t >= e.at && (!e.host || e.host === host))!;
  return {
    urls,
    now: () => t,
    sleep: async (ms: number) => { t += ms; },
    fetchImpl: async (url: string) => {
      urls.push(url);
      const { pathname: path, host } = new URL(url);
      if (path === '/') return new Response(current(host).index);
      return new Response('', { status: current(host).status[path] ?? 404 });
    },
  };
}
const SERVED = { '/assets/game-NEW.js': 200, '/assets/game-NEW.css': 200 };

describe('release gate', () => {
  it('lists the hashed chunks an index references', () => {
    expect(releaseChunks(NEW)).toEqual(['/assets/game-NEW.css', '/assets/game-NEW.js']);
  });
  it('waits through the window where the new HTML is live but its chunks 404, then passes', async () => {
    const w = fakeWorld([
      { at: 0, index: OLD, status: { '/assets/game-OLD.js': 200, '/assets/game-OLD.css': 200 } },
      { at: 10_000, index: NEW, status: { '/assets/game-OLD.js': 200 } },                              // new HTML, chunks 404
      { at: 60_000, index: NEW, status: { '/assets/game-NEW.js': 200, '/assets/game-NEW.css': 200 } },
    ]);
    const result = await waitForReleaseChunks({ origin: 'https://x.test', expectedHtml: NEW, ...w });
    expect(result.chunks).toHaveLength(2);
    // First clean check at 60 s, then a full 60 s of consecutive clean checks before it passes.
    expect(result.ms).toBeGreaterThanOrEqual(120_000);
    expect(result.passes).toBeGreaterThanOrEqual(12);
  });
  it('#6.22: one early 200 is not enough — a 404 mid-window resets the streak', async () => {
    const w = fakeWorld([
      { at: 0, index: NEW, status: SERVED },                                       // served at once…
      { at: 30_000, index: NEW, status: { '/assets/game-NEW.css': 200 } },        // …then another edge 404s the JS
      { at: 40_000, index: NEW, status: SERVED },
    ]);
    const log: string[] = [];
    const result = await waitForReleaseChunks({ origin: 'https://x.test', expectedHtml: NEW, ...w, log: (m: string) => log.push(m) });
    expect(result.ms).toBeGreaterThanOrEqual(100_000);
    expect(log.some(m => /streak of \d+ reset.*game-NEW\.js → 404/.test(m))).toBe(true);
  });
  it('checks every origin, and each chunk both plain and cache-busted', async () => {
    const w = fakeWorld([
      { at: 0, index: NEW, status: SERVED },
      { at: 0, host: 'b.test', index: NEW, status: { '/assets/game-NEW.css': 200 } },
      { at: 50_000, host: 'b.test', index: NEW, status: SERVED },
    ]);
    const result = await waitForReleaseChunks({ origins: ['https://a.test', 'https://b.test'], expectedHtml: NEW, ...w });
    expect(result.ms).toBeGreaterThanOrEqual(110_000);
    expect(w.urls).toContain('https://b.test/assets/game-NEW.js');
    expect(w.urls.some(u => /^https:\/\/a\.test\/assets\/game-NEW\.js\?release-gate=/.test(u))).toBe(true);
  });
  it('fails loudly when the chunks never become servable within the timeout', async () => {
    const w = fakeWorld([{ at: 0, index: NEW, status: { '/assets/game-NEW.css': 200 } }]);
    await expect(waitForReleaseChunks({ origin: 'https://x.test', expectedHtml: NEW, timeoutMs: 30_000, ...w }))
      .rejects.toThrow(/Release gate FAILED.*game-NEW\.js → 404/);
  });
});
