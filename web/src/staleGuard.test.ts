import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

/** index.html's inline stale-release guard, run against a fake window (deploy window: a 404'd /assets chunk). */
function bootGuard() {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const code = html.match(/\/\/ Stale-release guard[\s\S]*?\n(\(function[\s\S]*?)<\/script>/)![1]!;
  const listeners = new Map<string, ((event: unknown) => void)[]>();
  const values = new Map<string, string>();
  const timers: { fn: () => void; ms: number }[] = [];
  const detail = { textContent: 'Loading the waterfront…' };
  let reloads = 0, clock = 0;
  const window = { addEventListener: (type: string, fn: (event: unknown) => void) => listeners.set(type, [...listeners.get(type) ?? [], fn]) };
  runInNewContext(code, {
    window, document: { getElementById: () => detail },
    sessionStorage: { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => values.set(k, v) },
    setTimeout: (fn: () => void, ms: number) => timers.push({ fn, ms }),
    location: { reload: () => { reloads++; } },
    Date: { now: () => clock },
  });
  const fire = (type: string, event: unknown) => listeners.get(type)?.forEach(fn => fn(event));
  /** A page load: the guard's pending flag is per page, so each "reload" re-runs the guard against the same storage. */
  return { fire, timers, detail, get reloads() { return reloads; }, tick: (ms: number) => { clock += ms; }, values, listeners };
}

describe('stale-release guard (index.html)', () => {
  it('reloads on a 404 stylesheet or modulepreload under /assets, not on other links', () => {
    const g = bootGuard();
    g.fire('error', { target: { tagName: 'LINK', rel: 'icon', href: 'https://gtasf.com/favicon.ico' } });
    expect(g.timers).toHaveLength(0);
    g.fire('error', { target: { tagName: 'LINK', rel: 'stylesheet', href: 'https://gtasf.com/assets/game-X.css' } });
    expect(g.timers.map(t => t.ms)).toEqual([1000]);
    expect(g.detail.textContent).toMatch(/Updating/);
    g.timers[0]!.fn();
    expect(g.reloads).toBe(1);
  });
  it('backs off 1, 2, 4, 8, 15, 30 s (~60 s) across reloads, then stops and says so', () => {
    const waits: number[] = [];
    let last: ReturnType<typeof bootGuard> | undefined, stored: Map<string, string> | undefined;
    for (let page = 0; page < 7; page++) {
      const g = bootGuard();
      if (stored) for (const [k, v] of stored) g.values.set(k, v);
      g.fire('error', { target: { tagName: 'SCRIPT', type: 'module' } });
      waits.push(...g.timers.map(t => t.ms));
      stored = g.values; last = g;
    }
    expect(waits).toEqual([1000, 2000, 4000, 8000, 15000, 30000]);
    expect(waits.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(60_000);
    expect(last!.detail.textContent).toMatch(/Couldn’t load the latest version/);
  });
});
