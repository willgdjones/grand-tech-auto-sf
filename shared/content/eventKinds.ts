/**
 * Event-kind classification + SA-style radar/map icon styles (PLAN-v2.1 radar overhaul,
 * gtasf-radar-overhaul-v21-wivr). Tech Week events have no explicit category, so the kind is derived
 * from the title (and venue) by keyword — pure + deterministic + unit-testable, like the feedback
 * theme classifier. The radar, map and 3D markers all share this so an event looks the same everywhere.
 */
export type EventKind = 'investor' | 'demo' | 'party' | 'hackathon' | 'talk' | 'networking' | 'event';

export interface EventKindStyle {
  kind: EventKind;
  /** Legend label. */
  label: string;
  /** Glyph drawn on the blip (recognizable at radar size). */
  glyph: string;
  /** Blip fill colour. */
  color: string;
}

/** Legend order = scoring tie-break order. Colours are distinct + readable on the dark radar. */
export const EVENT_KINDS: readonly EventKindStyle[] = [
  { kind: 'investor', label: 'Investor / fundraising', glyph: '$', color: '#5fd07a' },
  { kind: 'demo', label: 'Demo / pitch', glyph: '🎤', color: '#f0b429' },
  { kind: 'hackathon', label: 'Hackathon / build', glyph: '💻', color: '#5aa9e6' },
  { kind: 'party', label: 'Party / mixer', glyph: '🍸', color: '#e06fb4' },
  { kind: 'talk', label: 'Talk / panel', glyph: '🎙', color: '#c89bf0' },
  { kind: 'networking', label: 'Networking', glyph: '🤝', color: '#e3a06f' },
  { kind: 'event', label: 'Tech Week event', glyph: '★', color: '#f6d87a' },
];

const STYLE_BY_KIND = new Map<EventKind, EventKindStyle>(EVENT_KINDS.map(style => [style.kind, style]));

export function eventKindStyle(kind: EventKind): EventKindStyle {
  return STYLE_BY_KIND.get(kind) ?? EVENT_KINDS[EVENT_KINDS.length - 1]!;
}

const KEYWORDS: { kind: EventKind; re: RegExp }[] = [
  { kind: 'investor', re: /\b(investors?|vc|venture|fund(?:ing|raising|raiser)?|lp|angel|capital|office hours|term sheet|raise|cheque|check writing)\b/i },
  { kind: 'demo', re: /\b(demo day|demo|pitch(?:es|ing)?|showcase|launch|lightning (?:talk|round)|startup battle)\b/i },
  { kind: 'hackathon', re: /\b(hackathon|hack night|hack|buildathon|builders?|workshop|codelab|coding|build(?:ing| session)?)\b/i },
  { kind: 'party', re: /\b(party|after ?party|mixer|happy hour|drinks|social|rooftop|night ?club|night|bash|celebration|cocktail|brunch|dinner|gala)\b/i },
  { kind: 'talk', re: /\b(talk|panel|keynote|fireside|ama|q&a|lecture|seminar|discussion|debate|summit|salon|conference|forum)\b/i },
  { kind: 'networking', re: /\b(network(?:ing)?|meet ?up|coffee|connect|roundtable|community|breakfast|lunch)\b/i },
];

/** Classify by keyword score; ties fall to the earlier EVENT_KINDS entry. Pure + deterministic. */
export function classifyEventKind(title: string, venue = ''): EventKind {
  const text = `${title} ${venue}`;
  let best: EventKind = 'event', bestScore = 0;
  for (const { kind, re } of KEYWORDS) {
    const matches = text.match(new RegExp(re.source, 'gi'));
    const score = matches ? matches.length : 0;
    if (score > bestScore) { bestScore = score; best = kind; }
  }
  return best;
}
