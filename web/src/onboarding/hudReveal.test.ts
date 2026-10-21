import { describe, expect, it } from 'vitest';
import { ALL_HUD_PANELS, freshOnboarding, panelsVisibleAt, setOnboardingStep } from '@gtasf/shared/onboarding/state';
import { lockedAttribute, revealCss } from './hudReveal';

describe('progressive HUD reveal', () => {
  it('locks everything but radar + funding for a new player', () => {
    const locked = lockedAttribute([...panelsVisibleAt(freshOnboarding())]).split(' ');
    expect(locked).toEqual(expect.arrayContaining(['map', 'events', 'vcDrop', 'outbid', 'chat', 'friends']));
    expect(locked).not.toContain('radar');
    expect(locked).not.toContain('funding');
  });

  it('unlocks the map + events at the GPS step and nothing stays locked when done', () => {
    const gps = lockedAttribute([...panelsVisibleAt(setOnboardingStep(freshOnboarding(), 'gps'))]);
    expect(gps).not.toContain('map');
    expect(gps).not.toContain('events');
    expect(lockedAttribute([...ALL_HUD_PANELS])).toBe('');
  });

  it('emits a hide rule per locked panel keyed on the body attribute', () => {
    const css = revealCss();
    expect(css).toContain('body[data-onb-locked~="map"] #map-toggle');
    expect(css).toContain('body[data-onb-locked~="outbid"] .gt-outbid-banner');
    expect(css).toContain('body[data-onb-locked] #keyboard-help');
  });
});
