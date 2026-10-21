import { describe, expect, it } from 'vitest';
import { classifyEventKind, eventKindStyle, EVENT_KINDS } from './eventKinds';

describe('classifyEventKind', () => {
  it('maps titles to kinds by keyword', () => {
    expect(classifyEventKind('Seed investor office hours')).toBe('investor');
    expect(classifyEventKind('AI Startup Demo Day')).toBe('demo');
    expect(classifyEventKind('24h Tech Week Hackathon')).toBe('hackathon');
    expect(classifyEventKind('Founders rooftop happy hour')).toBe('party');
    expect(classifyEventKind('Fireside panel with a famous VC', '')).toBe('talk'); // panel+fireside outscore the lone "vc"
    expect(classifyEventKind('Founder networking meetup')).toBe('networking');
  });

  it('catches real-feed patterns: plural investors, summit/salon, night, builders', () => {
    expect(classifyEventKind('Deep Tech Investors Lunch')).toBe('investor'); // plural "investors" (was a miss)
    expect(classifyEventKind('Contextful AI Summit')).toBe('talk');
    expect(classifyEventKind('VIP Salon on AI Judgment')).toBe('talk');
    expect(classifyEventKind('Founders Night')).toBe('party');
    expect(classifyEventKind('Coffee Rave for AI Builders')).toBe('hackathon');
  });

  it('falls back to a generic event with no keywords', () => {
    expect(classifyEventKind('Tech Week')).toBe('event');
    expect(classifyEventKind('')).toBe('event');
  });

  it('is deterministic and considers the venue text too', () => {
    const t = 'Open house';
    expect(classifyEventKind(t, 'The Hack Lab')).toBe('hackathon');
    expect(classifyEventKind(t, 'The Hack Lab')).toBe(classifyEventKind(t, 'The Hack Lab'));
  });
});

describe('eventKindStyle', () => {
  it('gives every kind a label, glyph and colour, with unique colours', () => {
    for (const kind of EVENT_KINDS.map(k => k.kind)) {
      const style = eventKindStyle(kind);
      expect(style.label.length).toBeGreaterThan(0);
      expect(style.glyph.length).toBeGreaterThan(0);
      expect(style.color).toMatch(/^#[0-9a-f]{6}$/i);
    }
    expect(new Set(EVENT_KINDS.map(k => k.color)).size).toBe(EVENT_KINDS.length);
  });
});
