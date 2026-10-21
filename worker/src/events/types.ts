export type EventSource = 'tech-week' | 'luma' | 'partiful' | 'eventbrite';

/** UTC ISO instants; null means unavailable, never an invented end/address. */
export interface TechWeekEvent {
  id: string;
  title: string;
  host: string | null;
  start: string;
  end: string | null;
  venue: string | null;
  address: string | null;
  lat: number | null;
  lon: number | null;
  approx: boolean;
  url: string;
  source: EventSource;
  tags: string[];
  /** True for player-submitted "community" events (PLAN-v2 decision 9); omitted for official feed events. */
  community?: boolean;
}

/** Parser-only metadata is deliberately excluded from the published contract. */
export interface EventCandidate {
  title?: string;
  host?: string;
  start?: string;
  end?: string;
  venue?: string;
  address?: string;
  lat?: number;
  lon?: number;
  timeZone?: string;
  neighborhood?: string;
  hidden?: boolean;
  virtual?: boolean;
  url: string;
  source: EventSource;
  tags?: string[];
}

export interface Coordinates { lat: number; lon: number }
export interface GeocodeQuery { venue: string | null; address: string | null; city: 'San Francisco' }
export interface GeocodeMatch extends Coordinates {
  /** City/neighborhood matches must never be treated as a precise venue. */
  precision: 'address' | 'venue' | 'neighborhood' | 'city';
}
export type Geocoder = (query: GeocodeQuery) => Promise<GeocodeMatch | null>;
export interface EventClassification { tags: string[]; spam: boolean }
/** The Jev adapter belongs to the caller; source text is untrusted data. */
export type EventTagger = (event: Readonly<TechWeekEvent>) => Promise<EventClassification>;

export interface CrawlIssue {
  url: string;
  stage: 'fetch' | 'parse' | 'geocode' | 'tag';
  message: string;
}
export interface CrawlResult {
  events: TechWeekEvent[];
  issues: CrawlIssue[];
  enabled: boolean;
  truncated: boolean;
  pagesFetched: number;
  taggingApplied: boolean;
}
