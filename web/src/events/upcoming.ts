import type { TaxiQuote } from '../vehicles/robotaxi/client';
import { flags } from '@gtasf/shared/flags';
import { formatFunding, isPreviewLull, quoteFunding } from '@gtasf/shared/funding';
import { holdFreeCursor } from '../input/cursor';
import { projectLocation, type MapFrame } from '../radar/projection';
import type { RadarEvent } from '../radar/radar';
import { distanceLabel, eventCallout, eventTime, isLiveEvent, matchesPeriod, upcomingEvents, type EventPeriod } from './schedule';
import './upcoming.css';

function node<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const result = document.createElement(tag); result.className = className; if (text) result.textContent = text; return result;
}
function button(text: string, action: () => void): HTMLButtonElement {
  const result = node('button', '', text); result.type = 'button'; result.onclick = action; return result;
}
type SelectResult = string | boolean | void;

/** V and the touch-sized HUD button share one accessible, non-blocking event view. */
export function createUpcomingEvents(options: {
  frame: MapFrame; parent?: HTMLElement; buttonParent?: HTMLElement; enabled?: boolean;
  onSelect(event: RadarEvent): SelectResult; onHail(event: RadarEvent): SelectResult;
  onOpenChange?(open: boolean): void;
  quoteFare?(event: RadarEvent): Promise<TaxiQuote>;
  neighbourhoodAt?(point: { x: number; z: number }): string | null;
  now?(): number;
}) {
  if (!(options.enabled ?? (flags.eventsView && flags.hud && (flags.eventsApi || flags.events || flags.localEventSnapshot)))) return null;
  const root = node('section', 'gt-upcoming'); root.hidden = true; root.tabIndex = -1;
  root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true'); root.setAttribute('aria-labelledby', 'gt-upcoming-title');
  const heading = node('h2', '', 'Upcoming events'); heading.id = 'gt-upcoming-title';
  const close = button('Close ×', () => toggle(false)); close.setAttribute('aria-label', 'Close upcoming events');
  const header = node('header', 'gt-upcoming-header'); header.append(heading, close);
  const tabs = node('div', 'gt-upcoming-tabs'); tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-label', 'Event dates');
  const search = node('input', 'gt-upcoming-search'); search.type = 'search'; search.placeholder = 'Search title, host or neighbourhood'; search.setAttribute('aria-label', 'Search upcoming events');
  const sortLabel = node('label', 'gt-upcoming-sort', 'Sort events');
  const sort = node('select', ''); sort.setAttribute('aria-label', 'Sort events');
  const sortChoices: [string, string][] = [['time', 'Earliest first'], ['distance', 'Nearest first']];
  if (flags.fundingLoop) sortChoices.push(['funding', 'Highest raise now']);
  for (const [value, text] of sortChoices) {
    const option = node('option', '', text); option.value = value; sort.append(option);
  }
  sortLabel.append(sort);
  const note = node('p', 'gt-upcoming-note');
  const fundingBasis = flags.driveThroughFunding
    ? 'Drive or walk through an event’s marker to get funded — each event pays once, ever.'
    : 'Each event pays once per SF day.';
  const fundingNote = node('p', 'gt-upcoming-note', `Game-funding estimates before crowd and streak bonuses. Timing may change en route. ${fundingBasis}`); fundingNote.hidden = !flags.fundingLoop;
  const status = node('p', 'gt-upcoming-status'); status.setAttribute('role', 'status');
  const list = node('div', 'gt-upcoming-list'); list.id = 'gt-upcoming-list'; list.setAttribute('role', 'tabpanel');
  const more = button('Show more events', () => {
    const previousCount = list.childElementCount;
    limit += 50; render();
    const firstNew = (list.children[previousCount] ?? list.firstElementChild) as HTMLElement | null;
    if (!firstNew) { close.focus(); return; }
    const action = firstNew.querySelector<HTMLElement>('button:not(:disabled),a[href]');
    if (action) action.focus();
    else { firstNew.tabIndex = 0; firstNew.focus(); }
  }); more.className = 'gt-upcoming-more'; more.hidden = true;
  root.append(header, tabs, search, sortLabel, note, fundingNote, status, list, more); (options.parent ?? document.body).append(root);
  const openButton = button('', () => { if(root.hidden){period=liveCount?'live':'week';limit=50;}toggle(); }); openButton.className = 'gt-upcoming-open';
  const calloutLabel=node('strong','gt-upcoming-callout-label',`Tech Week events · ${flags.proximityVoice ? 'J' : 'V'}`),calloutTitle=node('span','gt-upcoming-callout-title','Oct 5–11 · San Francisco');openButton.append(calloutLabel,calloutTitle);
  openButton.setAttribute('aria-haspopup', 'dialog'); openButton.setAttribute('aria-expanded', 'false');
  (options.buttonParent ?? document.body).append(openButton);
  let events: RadarEvent[] = [], period: EventPeriod = 'week', limit = 50, ready = false, disposed = false, loadError = '';
  const abort = new AbortController();
  let loadGeneration = 0;
  let position = { x: 0, z: 0 }, lastRefresh = -Infinity, lastCallout = -Infinity, liveCount=0, releaseCursor: (() => void) | undefined, previousFocus: HTMLElement | null = null;
  const clock = options.now ?? Date.now;
  const locations = new Map<string, { point: { x: number; z: number } | null; neighbourhood: string }>();
  function locationFor(event: RadarEvent) {
    const cached=locations.get(event.id);if(cached)return cached;
    const located=typeof event.lat==='number'&&Number.isFinite(event.lat)&&typeof event.lon==='number'&&Number.isFinite(event.lon);
    const point=located?projectLocation(event.lat!,event.lon!,options.frame):null;
    const value={point,neighbourhood:point?options.neighbourhoodAt?.(point)||event.venue||'San Francisco':'Online / no public map location'};
    locations.set(event.id,value);return value;
  }
  const periods: [EventPeriod, string][] = [['live', 'Live now'], ['today', 'Today'], ['tomorrow', 'Tomorrow'], ['week', 'Tech Week']];
  function selectPeriod(value: EventPeriod) { period = value; limit = 50; render(); }
  const tabButtons = periods.map(([value, label], index) => {
    const tab = button(label, () => selectPeriod(value)); tab.id = `gt-upcoming-tab-${value}`;
    tab.setAttribute('role', 'tab'); tab.setAttribute('aria-controls', list.id);
    tab.addEventListener('keydown', event => dateKeydown(event, index));
    tabs.append(tab); return { value, label, tab };
  });
  function dateKeydown(event: KeyboardEvent, index: number) {
    if (event.isComposing || event.keyCode === 229) return;
    if (event.ctrlKey || event.altKey || event.metaKey) return;
    const next = event.key === 'ArrowRight' ? (index + 1) % tabButtons.length
      : event.key === 'ArrowLeft' ? (index + tabButtons.length - 1) % tabButtons.length
      : event.key === 'Home' ? 0 : event.key === 'End' ? tabButtons.length - 1 : -1;
    if (next < 0) return;
    event.preventDefault(); event.stopPropagation();
    selectPeriod(tabButtons[next]!.value); tabButtons[next]!.tab.focus({ preventScroll: true });
  }
  function select(event: RadarEvent, hail: boolean) {
    const latest=events.find(value=>value.id===event.id);
    if(!latest){status.textContent='This event is no longer in the current calendar. Choose another event.';return;}
    const result = hail ? options.onHail(latest) : options.onSelect(latest);
    if (typeof result === 'string') { status.textContent = result; return; }
    if (result !== false) toggle(false);
  }
  function renderCallout(){
    const now=clock();lastCallout=now;const callout=eventCallout(events,now);liveCount=callout.liveCount;
    openButton.classList.toggle('gt-upcoming-happening',liveCount>0);
    calloutLabel.textContent=liveCount?`${liveCount} happening now${flags.fundingLoop ? ' · ×3' : ''} · ${flags.proximityVoice ? 'J' : 'V'}`:`Tech Week events · ${flags.proximityVoice ? 'J' : 'V'}`;
    calloutTitle.textContent=callout.event?`${liveCount?'LIVE':'NEXT'} · ${callout.event.title}`:loadError?'Events temporarily unavailable':'Oct 5–11 · San Francisco';
    openButton.title=callout.event?`${callout.event.title} · ${eventTime(callout.event)}`:calloutTitle.textContent;
    openButton.setAttribute('aria-label',liveCount?`${liveCount} events happening now.${flags.fundingLoop ? ' Live funding pays triple.' : ''} Open event list. ${callout.event?.title??''}`:`Open Tech Week events, October 5–11.${callout.event?` Next: ${callout.event.title}, ${eventTime(callout.event)}`:''}`);
  }
  function render() {
    const now = clock(); lastRefresh = now;
    for (const { value, label, tab } of tabButtons) {
      tab.textContent = `${label} (${events.filter(event => matchesPeriod(event, value, now)).length})`;
      tab.setAttribute('aria-selected', String(value === period));
      tab.tabIndex = value === period ? 0 : -1;
      if (value === period) list.setAttribute('aria-labelledby', tab.id);
    }
    note.textContent = `${period === 'week' ? 'All of Tech Week, Oct 5–11. ' : ''}Times in San Francisco. Approximate locations use the public neighbourhood.`;
    const previewLull = isPreviewLull(events, now); // pre-Tech-Week: future previews quote at the upcoming rate
    const selected = upcomingEvents(events, period, search.value, now, event => locationFor(event).neighbourhood).map(event => {
      const location = locationFor(event);
      return { event, ...location, distanceM: location.point ? Math.hypot(location.point.x - position.x, location.point.z - position.z) : Infinity,
        quote: flags.fundingLoop && location.point ? quoteFunding(event, now, 0, 1, previewLull) : null };
    });
    if (sort.value === 'distance') selected.sort((a, b) => a.distanceM - b.distanceM);
    else if (sort.value === 'funding' && flags.fundingLoop) selected.sort((a, b) => {
      const first = BigInt(a.quote?.amountCents ?? '-1'), second = BigInt(b.quote?.amountCents ?? '-1');
      return first === second ? 0 : first > second ? -1 : 1;
    });
    const order = sort.value === 'distance' ? 'nearest first · straight-line distances' : sort.value === 'funding' ? 'highest estimated raise now' : 'earliest first';
    status.textContent = loadError || (!ready ? 'Loading real Tech Week events…' : selected.length ? `${selected.length} events · ${order}` : search.value ? 'No matching events. Try another search or date tab.' : 'No events in this period. Try another date tab.');
    list.replaceChildren(); more.hidden = selected.length <= limit;
    for (const { event, point, neighbourhood, distanceM, quote } of selected.slice(0, limit)) {
      const located=point!==null;
      const distance = point ? `${event.approx ? '≈ ' : ''}${distanceLabel(distanceM)} away` : 'No driving destination';
      const row = node('article', 'gt-upcoming-row'); row.dataset.eventId = event.id;
      const choose = button('', () => select(event, false)); choose.className = 'gt-upcoming-choose'; choose.disabled = !located;
      choose.setAttribute('aria-label', `${event.community ? 'Community event. ' : ''}Set destination: ${event.title}`);
      choose.append(node('strong', '', event.title));
      // Community events (PLAN-v2 decision 9) carry a visible tag so they read apart from the official feed.
      if (event.community) choose.append(node('span', 'gt-upcoming-community', 'COMMUNITY'));
      choose.append(node('span', 'gt-upcoming-host', event.host || 'Host on event page'),
        node('span', 'gt-upcoming-time', `${isLiveEvent(event, now) ? 'LIVE · ' : ''}${eventTime(event)}`),
        node('span', 'gt-upcoming-place', `${neighbourhood} · ${distance}`));
      if (quote) {
        const timing = quote.timing === 'live' ? 'LIVE' : quote.timing === 'upcoming' ? 'Starts within 2 hours' : 'Outside live window';
        const collect = flags.driveThroughFunding ? 'drive through to collect' : '20 sec in marker';
        const estimate = `Raise now ~${formatFunding(quote.amountCents)} · ${timing} ×${quote.timeMultiplier} · ${collect}`;
        choose.append(node('span', 'gt-upcoming-funding', estimate));
        choose.setAttribute('aria-label', `${event.community ? 'Community event. ' : ''}Set destination: ${event.title}. ${estimate}`);
      }
      const actions = node('div', 'gt-upcoming-actions');
      let farePending = false, fareFailed = false;
      const hail = button('Hail robotaxi to this event', () => {
        if (farePending) return;
        if (fareFailed) { void refreshFare(); return; }
        select(event, true);
      }); hail.disabled = !located;
      async function refreshFare() {
        if (disposed || farePending || !options.quoteFare) return;
        farePending = true; fareFailed = false;
        hail.textContent = 'Ride here · Checking fare…'; hail.disabled = true; hail.setAttribute('aria-busy', 'true');
        try {
          const fare = await options.quoteFare(event);
          if (disposed || !hail.isConnected) return;
          // Timeouts and reconnects resolve with an empty fare rather than rejecting.
          if (!fare.fareCents) throw new Error('Fare unavailable');
          hail.textContent = `Ride here · ${fare.label}`; hail.disabled = !fare.affordable;
        } catch {
          if (disposed || !hail.isConnected) return;
          fareFailed = true; hail.textContent = 'Fare unavailable · Retry fare'; hail.disabled = false;
        } finally {
          farePending = false; hail.removeAttribute('aria-busy');
        }
      }
      actions.append(hail);
      try {
        const url = new URL(event.url);
        if (url.protocol === 'https:' || url.protocol === 'http:') {
          const link = node('a', '', 'Event page ↗'); link.href = url.href; link.target = '_blank'; link.rel = 'noopener noreferrer'; actions.append(link);
        }
      } catch { /* Keep usable event fields when its source link is malformed. */ }
      row.append(choose, actions); list.append(row);
      if (options.quoteFare && located) void refreshFare();
    }
  }
  function toggle(force?: boolean) {
    if (disposed) return;
    const open = force ?? root.hidden; if (open === !root.hidden) return;
    // A new panel may focus itself before its callback closes this calendar.
    const restoreFocus = !open && root.contains(document.activeElement);
    root.hidden = !open; openButton.setAttribute('aria-expanded', String(open));
    if (open) {
      previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      releaseCursor = holdFreeCursor(); if (document.pointerLockElement) document.exitPointerLock();
      render();
    } else {
      releaseCursor?.(); releaseCursor = undefined;
      if (restoreFocus) {
        const target = previousFocus?.isConnected && !previousFocus.matches(':disabled') && previousFocus.getClientRects().length && getComputedStyle(previousFocus).visibility !== 'hidden'
          ? previousFocus : openButton;
        target.focus({ preventScroll: true });
      }
      previousFocus = null;
    }
    options.onOpenChange?.(open);
    // The integration closes native dialogs first, making this search focusable.
    if (open && !disposed && !root.hidden) search.focus();
  }
  function keydown(event: KeyboardEvent) {
    if (event.isComposing || event.keyCode === 229) return;
    const target = event.target as HTMLElement | null;
    const editing = target?.closest('input,textarea,select,[contenteditable="true"]');
    if (event.code === (flags.proximityVoice ? 'KeyJ' : 'KeyV') && !event.repeat && !editing && !event.ctrlKey && !event.altKey && !event.metaKey) { event.preventDefault(); toggle(); }
    else if (!root.hidden && event.code === 'Escape') { event.preventDefault(); toggle(false); }
    else if (!root.hidden && event.code === 'Tab' && !event.ctrlKey && !event.altKey && !event.metaKey) {
      const focusable = [...root.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex]')]
        .filter(element => element.tabIndex >= 0 && !element.matches(':disabled') && element.getClientRects().length && getComputedStyle(element).visibility !== 'hidden');
      const first = focusable[0], last = focusable.at(-1), active = document.activeElement;
      if (!first) { event.preventDefault(); root.focus(); }
      else if (!root.contains(active) || active === root || (event.shiftKey ? active === first : active === last)) {
        event.preventDefault(); (event.shiftKey ? last : first)?.focus();
      }
    }
  }
  search.addEventListener('input', () => { limit = 50; render(); }); sort.addEventListener('change', () => { limit = 50; render(); }); window.addEventListener('keydown', keydown);
  return {
    element: root, button: openButton, toggle,
    get isOpen() { return !root.hidden; },
    setEvents(values: readonly RadarEvent[]) {
      if(disposed)return;
      loadGeneration++;
      events = values.filter(event => Number.isFinite(Date.parse(event.start))); locations.clear(); ready = true; loadError = ''; renderCallout();
      // Keep the currently focused/hovered row stable during background calendar updates.
      if (!root.hidden && !list.matches(':hover') && !list.contains(document.activeElement)) render();
      else lastRefresh=-Infinity;
    },
    async load(url = '/api/events') {
      if (disposed) return;
      const generation = ++loadGeneration;
      try {
        const response = await fetch(url, { signal: abort.signal }); if (!response.ok) throw new Error(`Events HTTP ${response.status}`);
        const data = await response.json() as { events?: RadarEvent[] };
        if (!disposed && generation === loadGeneration) { events = (data.events ?? []).filter(event => Number.isFinite(Date.parse(event.start))); locations.clear(); ready = true; loadError = ''; renderCallout();if (!root.hidden) render(); }
      } catch (error) { if (!disposed && generation === loadGeneration) { ready = true; loadError = 'Events could not load. Reopen the game to try again.'; if (!root.hidden) render(); } }
    },
    setError(message: string) { if(disposed)return;loadGeneration++;ready = true; loadError = message; status.textContent = message;renderCallout(); },
    update(at: { x: number; z: number }) {
      position = at;
      if(clock()-lastCallout>15_000)renderCallout();
      // Avoid DOM work while closed or replacing a row beneath the user's pointer/focus.
      if (!root.hidden && clock() - lastRefresh > 30_000 && !list.matches(':hover') && !list.contains(document.activeElement)) render();
    },
    destroy() { if (disposed) return; toggle(false); disposed = true; abort.abort(); locations.clear(); window.removeEventListener('keydown', keydown); root.remove(); openButton.remove(); },
  };
}
