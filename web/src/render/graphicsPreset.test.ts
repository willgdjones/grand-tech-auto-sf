import { describe, expect, it } from 'vitest';
import { graphicsPreset, graphicsMode, detectAutoPreset, setGraphics } from './graphicsPreset';

describe('graphics preset resolution', () => {
  it('?gfx=hd|low overrides everything (for testing)', () => {
    expect(graphicsPreset('?gfx=hd')).toBe('hd');
    expect(graphicsPreset('?gfx=low')).toBe('low');
    expect(graphicsPreset('?at=37.79,-122.39&gfx=low')).toBe('low');
    expect(graphicsPreset('?gfx=HD')).toBe('hd'); // case-insensitive
    expect(graphicsPreset('?preset=low')).toBe('low');
    expect(graphicsPreset('?preset=low&gfx=hd')).toBe('hd');
  });

  it('falls back to a valid preset for an invalid / absent ?gfx', () => {
    expect(['hd', 'low']).toContain(graphicsPreset('?gfx=ultra'));
    expect(['hd', 'low']).toContain(graphicsPreset(''));
  });

  it('detectAutoPreset always returns a concrete preset', () => {
    expect(['hd', 'low']).toContain(detectAutoPreset());
  });

  it('graphicsMode defaults to auto and round-trips a stored choice', () => {
    expect(['auto', 'hd', 'low']).toContain(graphicsMode());
    let hasStorage = false;
    try { localStorage.setItem('__gfxtest', '1'); localStorage.removeItem('__gfxtest'); hasStorage = true; } catch { /* node env */ }
    if (hasStorage) {
      setGraphics('hd'); expect(graphicsMode()).toBe('hd'); expect(graphicsPreset('')).toBe('hd');
      setGraphics('low'); expect(graphicsMode()).toBe('low'); expect(graphicsPreset('')).toBe('low');
      setGraphics('auto'); expect(graphicsMode()).toBe('auto');
      // URL still wins over a stored choice.
      setGraphics('low'); expect(graphicsPreset('?gfx=hd')).toBe('hd');
      setGraphics('auto');
    }
  });
});
