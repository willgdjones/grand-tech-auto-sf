/**
 * Organiser link landing card (docs/gtm/organiser-outreach.md part 1, flag organiserLinks).
 * gtasf.com/e/<event-id> spawns at the venue; this card says "<Event> is on the map" and offers a one-tap
 * Share on X that opens X's OWN compose intent, prefilled. The organiser posts from their account; we never post.
 */
import { track } from '../analytics';
import { isAutomatedVisit } from '../analytics/bot';

export type OrganiserChannel = 'dm' | 'em' | 'link';
/** Outreach channel from ?c= (docs/gtm/dm-template.md "Tracking"): dm, em, otherwise 'link' (organic shares). */
export function organiserChannel(search = location.search): OrganiserChannel {
  const c = new URLSearchParams(search).get('c');
  return c === 'dm' || c === 'em' ? c : 'link';
}
const MEDIUM: Record<OrganiserChannel, string | undefined> = { dm: 'dm', em: 'email', link: undefined };

/** No-PII aggregate counter (worker/src/gtm/organiserTrack.ts); counted regardless of analytics consent. */
export function organiserTrack(eventId: string, channel: OrganiserChannel, kind: 'view' | 'play_start' | 'share_click'): void {
  if (isAutomatedVisit()) return;
  const body = JSON.stringify({ eventId, channel, kind });
  try {
    if (navigator.sendBeacon?.('/api/gtm/organiser-track', body)) return;
    void fetch('/api/gtm/organiser-track', { method: 'POST', body, keepalive: true }).catch(() => undefined);
  } catch { /* best effort */ }
}

const SF_TIME = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

/** The link organisers share: gtasf.com/e/<id> with UTMs so visits attribute to this campaign. */
export function organiserShareUrl(eventId: string, origin = location.origin, channel: OrganiserChannel = 'link'): string {
  const url = new URL(`/e/${encodeURIComponent(eventId)}`, origin);
  url.searchParams.set('utm_source', 'organiser');
  if (MEDIUM[channel]) url.searchParams.set('utm_medium', MEDIUM[channel]!);
  url.searchParams.set('utm_campaign', 'event_on_map');
  url.searchParams.set('utm_content', eventId);
  return url.href;
}

/** X's web compose intent (x.com/intent/post); nothing is posted until the organiser presses Post. */
export function organiserTweetIntent(title: string, eventId: string, origin = location.origin, channel: OrganiserChannel = 'link'): string {
  const intent = new URL('https://x.com/intent/post');
  intent.searchParams.set('text', `Our ${title} is in Grand Tech Auto: San Francisco 🎮`);
  intent.searchParams.set('url', organiserShareUrl(eventId, origin, channel));
  return intent.href;
}

export function showOrganiserCard(event: { id: string; title: string; venue?: string | null; start?: string | null }): () => void {
  const channel = organiserChannel();
  const card = document.createElement('section');
  card.className = 'gt-organiser-card'; card.setAttribute('role', 'dialog'); card.setAttribute('aria-label', `${event.title} is on the map`);
  card.style.cssText = 'position:fixed;left:50%;top:max(120px,26vh);transform:translateX(-50%);z-index:60;width:min(440px,calc(100vw - 32px));'
    + 'box-sizing:border-box;padding:18px 20px;background:var(--sa-panel-bg-strong,rgba(0,0,0,.82));border:2px solid var(--sa-panel-edge,#000);'
    + 'color:#fff;font:15px/1.35 var(--sa-sans,Arial,sans-serif);text-shadow:0 1px 2px #000';
  const eyebrow = document.createElement('p'); eyebrow.textContent = 'TECH WEEK · LIVE IN GTASF';
  eyebrow.style.cssText = 'margin:0 0 6px;font-size:11px;letter-spacing:.14em;color:var(--sa-menu-blue,#b2cef2)';
  const title = document.createElement('h2');
  title.style.cssText = 'margin:0 0 8px;font:28px/1.05 var(--sa-display,Impact,sans-serif);color:var(--sa-title-gold,#f6a81e);text-transform:uppercase;-webkit-text-stroke:1px #000';
  title.textContent = `${event.title} is on the map`;
  const when = event.start && !Number.isNaN(Date.parse(event.start)) ? SF_TIME.format(new Date(event.start)) : '';
  const meta = document.createElement('p'); meta.style.cssText = 'margin:0 0 14px;color:#e3e3e3';
  const venue = event.venue && !/^(other|tbd|tba|online|virtual)$/i.test(event.venue.trim()) ? event.venue : null;
  meta.textContent = [venue, when].filter(Boolean).join(' · ') || 'San Francisco';
  const row = document.createElement('div'); row.style.cssText = 'display:flex;gap:10px;flex-wrap:wrap';
  const button = (label: string, primary: boolean) => {
    const b = document.createElement(primary ? 'a' : 'button') as HTMLAnchorElement | HTMLButtonElement;
    b.textContent = label;
    b.style.cssText = `flex:1 1 140px;min-height:44px;display:inline-flex;align-items:center;justify-content:center;padding:0 14px;font:bold 15px var(--sa-sans,Arial,sans-serif);
      text-decoration:none;cursor:pointer;border:2px solid #000;${primary ? 'background:var(--sa-gold,#f0b429);color:#000' : 'background:rgba(255,255,255,.12);color:#fff'}`;
    return b;
  };
  const share = button('Share on X', true) as HTMLAnchorElement;
  share.href = organiserTweetIntent(event.title, event.id, location.origin, channel);
  share.addEventListener('click', () => { organiserTrack(event.id, channel, 'share_click'); track('organiser_share_click', { event_id: event.id, channel }); }); share.target = '_blank'; share.rel = 'noopener noreferrer';
  const play = button('Explore the city', false) as HTMLButtonElement; play.type = 'button';
  const close = () => { card.remove(); removeEventListener('keydown', onKey, true); };
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
  let played = false;
  play.addEventListener('click', () => { if (!played) { played = true; organiserTrack(event.id, channel, 'play_start'); } close(); });
  addEventListener('keydown', onKey, true);
  row.append(share, play); card.append(eyebrow, title, meta, row);
  document.body.append(card);
  // The D1 'view' counter fires at spawn resolution (every /e load, before the world finishes loading) from main.ts.
  track('organiser_link_view', { event_id: event.id, channel });
  return close;
}
