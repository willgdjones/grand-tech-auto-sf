import { describe, expect, it } from 'vitest';
import { classifyTheme, feedbackDigest } from './store';

describe('classifyTheme', () => {
  it('is deterministic and keyword-driven', () => {
    expect(classifyTheme('the driving feels great but braking is twitchy')).toBe('driving-and-controls');
    expect(classifyTheme('fps drops and it stutters near the ferry')).toBe('performance');
    expect(classifyTheme('the camera zoom is weird')).toBe('camera');
    expect(classifyTheme('I got lost, the map gps had no route')).toBe('map-and-navigation');
    expect(classifyTheme('closing a funding round was satisfying')).toBe('funding-and-events');
    expect(classifyTheme('chat bubbles from the other player covered my view')).toBe('multiplayer-and-chat');
    expect(classifyTheme('the radio music cut out')).toBe('audio');
    expect(classifyTheme('on my phone the touch joystick drifts')).toBe('mobile');
    expect(classifyTheme('the sky texture looks blurry')).toBe('visuals-and-look');
    expect(classifyTheme('the game crashed on load')).toBe('crash-or-bug');
  });

  it('prefers the feature theme over a generic "broken" for feature-specific complaints', () => {
    // "broken" alone is crash-or-bug, but with a car signal driving wins on score.
    expect(classifyTheme('the car controls are broken and the steering is broken')).toBe('driving-and-controls');
  });

  it('falls back to general with no keywords and never throws on odd input', () => {
    expect(classifyTheme('hi')).toBe('general');
    expect(classifyTheme('')).toBe('general');
    expect(classifyTheme('🙂🙂🙂')).toBe('general');
  });

  it('gives the same answer every time', () => {
    const text = 'the map route and the driving both felt off';
    expect(classifyTheme(text)).toBe(classifyTheme(text));
  });
});

/** Minimal D1 stand-in: feedbackDigest only runs one prepared SELECT ... .bind(limit).all(). */
function fakeDb(rows: Record<string, unknown>[]): D1Database {
  return {
    prepare() {
      return {
        bind() { return this; },
        async all() { return { results: rows, success: true, meta: {} }; },
      } as unknown as D1PreparedStatement;
    },
  } as unknown as D1Database;
}

describe('feedbackDigest', () => {
  it('groups by theme, orders by volume, and builds jump links from coordinates', async () => {
    const digest = await feedbackDigest(fakeDb([
      { id: 'a', created_at: '2026-10-03T20:05:00Z', text: 'braking is twitchy', theme: 'driving-and-controls', mode: 'driving', round: 'Seed', startup: 'Acme', nick: 'ace', lat: 37.7955, lon: -122.3937, location_name: 'The Embarcadero', screenshot: 'data:image/jpeg;base64,AAAA' },
      { id: 'b', created_at: '2026-10-03T20:04:00Z', text: 'camera weird', theme: 'camera', mode: null, round: null, startup: null, nick: null, lat: null, lon: null, location_name: null, screenshot: null },
      { id: 'c', created_at: '2026-10-03T20:03:00Z', text: 'drift too much', theme: 'driving-and-controls', mode: 'driving', round: null, startup: null, nick: null, lat: null, lon: null, location_name: null, screenshot: null },
    ]));
    expect(digest.total).toBe(3);
    expect(digest.themes.map(t => t.theme)).toEqual(['driving-and-controls', 'camera']);
    expect(digest.themes[0]!.count).toBe(2);
    expect(digest.themes[0]!.items[0]!.jump).toBe('/?at=37.795500,-122.393700');
    expect(digest.themes[0]!.items[0]!.hasScreenshot).toBe(true);
    expect(digest.themes[1]!.items[0]!.jump).toBeNull();
    expect(digest.themes[1]!.items[0]!.hasScreenshot).toBe(false);
  });

  it('handles an empty table', async () => {
    const digest = await feedbackDigest(fakeDb([]));
    expect(digest).toEqual({ total: 0, since: null, themes: [] });
  });
});
