import { describe, expect, it } from 'vitest';
import { introSlides, controlsForDevice } from './slides';

describe('intro slides', () => {
  it('has three slides, the last showing device controls, each with poster art', () => {
    const slides = introSlides(false);
    expect(slides).toHaveLength(3);
    expect(slides[0]!.controls).toBeUndefined();
    expect(slides[0]!.body && slides[0]!.body.length).toBeGreaterThan(0);
    expect(slides[2]!.controls && slides[2]!.controls.length).toBeGreaterThan(0);
    expect(slides.every(s => (s.imageSrc ?? '').startsWith('/art/loading/') && s.title.length > 0)).toBe(true);
    expect(slides.map(s => new URL(s.imageSrc!, 'https://gtasf.com/go/lombard').pathname))
      .toEqual(slides.map(s => s.imageSrc));
    // Must point at the real shipped art (web/public/art/loading/onboarding-*.webp), not placeholders.
    expect(slides.map(s => s.imageSrc)).toEqual([
      '/art/loading/onboarding-raise.webp',
      '/art/loading/onboarding-events.webp',
      '/art/loading/onboarding-controls.webp',
    ]);
  });

  it('gives keyboard keys vs touch gesture labels per device (pane-8 ControlHint shape)', () => {
    const keyboard = controlsForDevice(false);
    const touch = controlsForDevice(true);
    expect(keyboard.every(c => typeof c.keys === 'string' && typeof c.label === 'string')).toBe(true);
    expect(keyboard.map(c => c.keys)).toContain('W A S D');
    expect(keyboard.map(c => c.keys)).toContain('H');
    // Chat opens with T, not Enter (matches integrate.ts chatNear glyph + gtasf-osfm 'Press T').
    expect(keyboard.find(c => c.label === 'Chat')!.keys).toBe('T');
    expect(keyboard.map(c => c.keys)).not.toContain('ENTER');
    expect(touch.map(c => c.keys)).toContain('LEFT STICK');
    expect(touch.map(c => c.keys).some(k => /^[A-Z]$/.test(k))).toBe(false); // no bare single-letter keys on touch
    expect(introSlides(true)[2]!.controls).toEqual(touch);
  });
});
