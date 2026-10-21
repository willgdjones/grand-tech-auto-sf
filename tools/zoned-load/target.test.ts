import { describe, expect, it } from 'vitest';
import { SF_ZONE_GRID } from '@gtasf/shared/world/zones';
import { assertStagingTarget, observerCellsFor, PRODUCTION_HOST_MARKERS } from './target';

describe('assertStagingTarget (never load-test production)', () => {
  it('refuses a missing or blank URL', () => {
    expect(() => assertStagingTarget(undefined)).toThrow(/No target URL/);
    expect(() => assertStagingTarget('   ')).toThrow(/No target URL/);
  });
  it('refuses the production Worker and Pages hosts', () => {
    expect(() => assertStagingTarget('wss://gtasf-production.acme.workers.dev')).toThrow(/PRODUCTION/);
    expect(() => assertStagingTarget('https://gtasf.pages.dev/api/world')).toThrow(/PRODUCTION/);
    for (const marker of PRODUCTION_HOST_MARKERS) expect(() => assertStagingTarget(`wss://${marker}`)).toThrow(/PRODUCTION/);
  });
  it('refuses an operator-supplied extra production marker (e.g. a custom domain)', () => {
    expect(() => assertStagingTarget('wss://play.gtasf.com', ['gtasf.com'])).toThrow(/PRODUCTION/);
  });
  it('refuses a malformed URL or a non-web scheme', () => {
    expect(() => assertStagingTarget('not a url')).toThrow(/Malformed/);
    expect(() => assertStagingTarget('ftp://gtasf-staging.workers.dev')).toThrow(/ws\/wss\/http\/https/);
  });
  it('accepts a staging host and normalises scheme + preserves port', () => {
    expect(assertStagingTarget('wss://gtasf-staging.acme.workers.dev')).toEqual({
      wsOrigin: 'wss://gtasf-staging.acme.workers.dev', httpOrigin: 'https://gtasf-staging.acme.workers.dev',
      hostname: 'gtasf-staging.acme.workers.dev', secure: true,
    });
    expect(assertStagingTarget('https://staging.example.com/api/world').wsOrigin).toBe('wss://staging.example.com');
    const local = assertStagingTarget('http://127.0.0.1:8787');
    expect(local).toMatchObject({ wsOrigin: 'ws://127.0.0.1:8787', httpOrigin: 'http://127.0.0.1:8787', secure: false });
  });
});

describe('observerCellsFor', () => {
  it('returns no observers for a bot deep in a cell centre', () => {
    // Centre of cell (0,0): x=-5400m, z=-5300m → -540000,-530000 cm.
    expect(observerCellsFor(-540_000, -530_000, SF_ZONE_GRID)).toEqual([]);
  });
  it('returns the adjacent cell for a bot within BORDER_SUBSCRIBE_M of a border', () => {
    // x=-4150m is 50m inside cell (0,0) from its east border (-4100m); z centred far from z-borders.
    const observers = observerCellsFor(-415_000, -530_000, SF_ZONE_GRID);
    expect(observers).toContainEqual({ cx: 1, cy: 0 });
  });
});
