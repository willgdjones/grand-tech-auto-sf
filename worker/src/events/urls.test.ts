import { expect, it } from 'vitest';
import { canonicalUrl, eventId, sourceOf } from './urls';

it('accepts Eventbrite event links and derives a stable id from the trailing numeric', () => {
  const slug = 'https://www.eventbrite.com/e/sf-tech-week-founder-mixer-tickets-1234567890';
  expect(sourceOf(slug)).toBe('eventbrite');
  expect(sourceOf('https://eventbrite.com/e/1234567890')).toBe('eventbrite');
  // Tracking params, host variant and trailing slash all normalize to one stable id.
  expect(eventId(`${slug}?aff=ebdssbdestsearch`)).toBe('eventbrite:1234567890');
  expect(eventId('https://eventbrite.com/e/sf-tech-week-founder-mixer-tickets-1234567890/')).toBe('eventbrite:1234567890');
  expect(canonicalUrl(`${slug}?aff=x`)).toBe('https://eventbrite.com/e/sf-tech-week-founder-mixer-tickets-1234567890');
});

it('rejects non-event Eventbrite paths and unsupported shapes', () => {
  expect(sourceOf('https://www.eventbrite.com/d/ca--san-francisco/events/')).toBeNull(); // discovery page
  expect(sourceOf('https://www.eventbrite.com/e/signin')).toBeNull(); // no numeric id
  expect(sourceOf('http://www.eventbrite.com/e/sf-mixer-tickets-1234567890')).toBeNull(); // not https
  expect(sourceOf('https://eventbrite.com/e/12345')).toBeNull(); // too-short id
  expect(sourceOf('https://evil-eventbrite.com/e/1234567890')).toBeNull(); // look-alike host
});

it('still recognises the existing providers', () => {
  expect(sourceOf('https://lu.ma/foundercoffee')).toBe('luma');
  expect(sourceOf('https://partiful.com/e/abc123')).toBe('partiful');
  expect(sourceOf('https://www.tech-week.com/calendar/sf')).toBe('tech-week');
});
