import { afterEach, describe, expect, it, vi } from 'vitest';
import { assignBucket, readBucket } from './bucket';

function makeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() { return map.size; },
    clear: () => map.clear(),
    getItem: (k: string) => map.get(k) ?? null,
    key: (i: number) => [...map.keys()][i] ?? null,
    removeItem: (k: string) => void map.delete(k),
    setItem: (k: string, v: string) => void map.set(k, String(v)),
  } as Storage;
}

afterEach(() => vi.unstubAllGlobals());

describe('founder bucket (A/B ended — everyone is ladder)', () => {
  it('always assigns ladder, regardless of the rng, and persists it (v2 key)', () => {
    vi.stubGlobal('localStorage', makeStorage());
    expect(readBucket()).toBeNull();
    expect(assignBucket(() => 0.2)).toBe('ladder'); // the old 'control' coin flip no longer applies
    expect(readBucket()).toBe('ladder');            // persisted
    expect(assignBucket(() => 0.9)).toBe('ladder');
  });

  it('ladder for every fresh device across the full rng range', () => {
    for (let i = 0; i < 1000; i++) {
      vi.stubGlobal('localStorage', makeStorage());
      expect(assignBucket(() => i / 1000)).toBe('ladder');
    }
  });

  it('a device bucketed control under the OLD v1 key now reads as ladder (v2 bump)', () => {
    vi.stubGlobal('localStorage', makeStorage());
    localStorage.setItem('gtasf.founder.bucket.v1', 'control'); // a stale v1 assignment
    expect(readBucket()).toBeNull();          // v2 key is unset → clean read
    expect(assignBucket(() => 0.2)).toBe('ladder');
    expect(readBucket()).toBe('ladder');
  });

  it('still ladder (per-session) when storage throws', () => {
    vi.stubGlobal('localStorage', { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } } as unknown as Storage);
    expect(assignBucket(() => 0.9)).toBe('ladder');
    expect(readBucket()).toBeNull();
  });
});
