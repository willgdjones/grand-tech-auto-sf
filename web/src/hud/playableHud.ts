import { flags } from '@gtasf/shared/flags';
import { FUNDED_TIERS } from '@gtasf/shared/content/flavour';
import { fundingCents, fundingRound, type FundingProfile } from '@gtasf/shared/funding';
import type { RadarEvent } from '../radar/radar';
import './playableHud.css';
import { clockOverride } from '../render/timeOverride';

const clockFormat = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const eventFormat = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const moneyCounter = (cents: bigint) => `$${(cents / 100n).toString().padStart(8, '0')}`;
const fundedTiersDescending = [...FUNDED_TIERS].reverse();
/** Server snapshot supplies cents/second; show rounded dollars/minute, never a countdown. */
export function burnRateLabel(profile: Pick<FundingProfile, 'round' | 'burnPerSecCents'> | undefined): string {
  if (!profile || profile.round.stars === 0 || !profile.burnPerSecCents) return '';
  let perMinute: bigint;
  try { perMinute = BigInt(profile.burnPerSecCents) * 60n; } catch { return ''; }
  if (perMinute <= 0n) return '';
  const dollars = (perMinute + 50n) / 100n;
  const tenths = (perMinute + 5000n) / 10000n;
  const amount = dollars < 1000n ? dollars.toString() : `${tenths / 10n}${tenths % 10n ? `.${tenths % 10n}` : ''}k`;
  return `BURN −$${amount}/min`;
}

function node<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text = '') {
  const el = document.createElement(tag); el.className = className; el.textContent = text; return el;
}
export interface HudState {
  now?: number;
  /** Server-validated distinct visits only. The HUD never awards progress. */
  validatedVisits?: number;
  fundingCents?: number;
  radioStation?: string;
  radioPlaying?: boolean;
  radioMuted?: boolean;
  radioTicker?: string;
}

/** Existing driving prompts/destination status remain owned by the game loop. */
export function createPlayableHud(options: {
  parent?: HTMLElement; onCardChange?(open: boolean): void; onShareEvent?(event: RadarEvent): Promise<void>;
} = {}) {
  if (!flags.hud) return null;
  const root = node('section', 'gt-hud'); root.setAttribute('aria-label', 'Player status');
  const clock = node('time', 'gt-hud-clock'), zone = node('span', 'gt-hud-zone', 'SAN FRANCISCO');
  const money = node('div', 'gt-hud-money'), stars = node('div', 'gt-hud-stars');
  const moneyLabel = node('span', 'gt-hud-money-label', 'FUNDING'), moneyValue = node('span', 'gt-hud-money-value');
  const burn = node('div', 'gt-hud-burn'); burn.hidden = true;
  money.append(moneyLabel, moneyValue, burn);
  const tier = node('div', 'gt-hud-tier'), rank = node('div', 'gt-hud-rank'), radio = node('div', 'gt-hud-radio');
  const radioTicker = node('div', 'gt-hud-radio-ticker'); radioTicker.hidden = true;
  rank.hidden = true; root.append(zone, clock, money, stars, tier, rank, radio, radioTicker);
  const card = node('section', 'gt-event-card'); card.hidden = true; card.setAttribute('role', 'dialog'); card.setAttribute('aria-modal', 'true'); card.setAttribute('aria-label', 'Tech Week event');
  const close = node('button', 'gt-event-close', 'Close ×'); close.type = 'button'; close.setAttribute('aria-label', 'Close event details');
  const title = node('h2', 'gt-event-title'), when = node('p', 'gt-event-when'), host = node('p', 'gt-event-host');
  const venue = node('p', 'gt-event-venue'), approximate = node('p', 'gt-event-approx'), attendance = node('p', 'gt-event-attendance');
  const link = node('a', 'gt-event-link', 'View event & RSVP ↗'); link.target = '_blank'; link.rel = 'noopener noreferrer';
  const share = node('button', 'gt-event-share', 'Share event'); share.type = 'button'; share.hidden = !options.onShareEvent;
  const shareStatus = node('p', 'gt-event-share-status'); shareStatus.setAttribute('role', 'status'); shareStatus.hidden = true;
  card.append(close, node('div', 'gt-event-kicker', 'SF TECH WEEK'), title, when, host, venue, approximate, attendance, link, share, shareStatus);
  (options.parent ?? document.body).append(root, card);
  let open = false, disposed = false, restoreFocus: HTMLElement | null = null, lastState = '';
  let fundingDisplay: { profile: FundingProfile; displayedCents: string } | undefined;
  let lastInput: HudState = {}, lastStars = '', lastTicker = '';
  let lastClockMinute = NaN, lastClockLabel = '';
  let lastFundingTotal: string | undefined, lastRound: ReturnType<typeof fundingRound> | undefined;
  let lastMoneyCents: string | number | undefined, lastMoneyLabel = '$--------';
  let shownEvent: RadarEvent | undefined;
  share.addEventListener('click', async () => {
    const event = shownEvent; if (!event || !options.onShareEvent || share.disabled) return;
    share.disabled = true; shareStatus.hidden = false; shareStatus.textContent = 'Copying event link…';
    try { await options.onShareEvent(event); if (shownEvent === event) shareStatus.textContent = 'Event location link copied.'; }
    catch (error) { if (shownEvent === event) shareStatus.textContent = error instanceof Error ? error.message : 'The event link could not be copied.'; }
    finally { share.disabled = false; }
  });
  function hideEvent() {
    if (!open) return;
    const ownedFocus = card.contains(document.activeElement), previous = restoreFocus;
    restoreFocus = null;
    open = false; card.hidden = true; options.onCardChange?.(false);
    // Another panel can take focus before or during the integration callback.
    if (ownedFocus && (card.contains(document.activeElement) || document.activeElement === document.body)
      && previous?.isConnected && usableControl(previous)) previous.focus({ preventScroll: true });
  }
  function usableControl(element: HTMLElement) {
    return !element.matches(':disabled') && element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden';
  }
  function onKey(event: KeyboardEvent) {
    if (!open) return;
    if (event.key === 'Escape') { event.preventDefault(); hideEvent(); return; }
    if (event.key !== 'Tab' || event.ctrlKey || event.altKey || event.metaKey) return;
    const controls = [...card.querySelectorAll<HTMLElement>('button,a[href]')].filter(element => element.tabIndex >= 0 && usableControl(element));
    const first = controls[0], last = controls.at(-1), active = document.activeElement;
    if (!controls.some(element => element === active) || (event.shiftKey ? active === first : active === last)) {
      event.preventDefault(); (event.shiftKey ? last : first)?.focus();
    }
  }
  close.addEventListener('click', hideEvent); document.addEventListener('keydown', onKey);
  function update(state: HudState = {}) {
    if (disposed) return;
    lastInput = state;
    // Follow the ?time= / Game-options override so the clock agrees with the sky.
    const now = state.now ?? (clockOverride()?.() ?? Date.now());
    const clockMinute = Math.floor(now / 60_000);
    if (clockMinute !== lastClockMinute) {
      lastClockLabel = clockFormat.format(now); lastClockMinute = clockMinute;
    }
    const visits = flags.eventVisits && flags.fundedStars && Number.isSafeInteger(state.validatedVisits)
      ? Math.max(0, state.validatedVisits!) : 0;
    const level = fundedTiersDescending.find(item => visits >= item.minValidatedVisits);
    const earned = flags.fundingLoop ? fundingDisplay : undefined;
    // Compare values: funding profiles and radio state may be mutated in place.
    const total = earned?.profile.totalCents;
    if (total !== lastFundingTotal) {
      lastRound = total === undefined ? undefined : fundingRound(total); lastFundingTotal = total;
    }
    const amountCents = earned ? earned.displayedCents : Number.isSafeInteger(state.fundingCents) && state.fundingCents! >= 0 ? state.fundingCents : undefined;
    if (amountCents !== lastMoneyCents) {
      lastMoneyLabel = amountCents === undefined ? '$--------'
        : moneyCounter(typeof amountCents === 'string' ? fundingCents(amountCents) : BigInt(amountCents));
      lastMoneyCents = amountCents;
    }
    const round = lastRound, time = lastClockLabel, amount = lastMoneyLabel;
    const burnText = flags.economyV3 ? burnRateLabel(earned?.profile) : '';
    const station = state.radioPlaying && state.radioStation ? `${state.radioStation}${state.radioMuted ? ' · MUTED' : ''}` : 'Radio off';
    const ticker = state.radioPlaying ? state.radioTicker ?? '' : '';
    const standing = earned?.profile.rank;
    const rankText = earned ? Number.isSafeInteger(standing) && standing! > 0 ? `#${standing} THIS WEEK` : 'UNRANKED' : '';
    // The epoch minute keeps dateTime current when a local clock label repeats.
    const key = `${clockMinute}|${time}|${amount}|${round?.id ?? level?.id}|${station}|${rankText}|${ticker}|${burnText}`; if (key === lastState) return; lastState = key;
    clock.textContent = time; clock.dateTime = new Date(now).toISOString(); clock.setAttribute('aria-label', `${time} San Francisco time`);
    moneyValue.textContent = amount;
    burn.textContent = burnText; burn.hidden = !burnText;
    money.classList.toggle('gt-hud-money-long', amount.length > 11);
    money.setAttribute('aria-label', amount === '$--------' ? 'Funding unavailable' : `Funding ${amount.replace(/^\$0+(?=\d)/, '$')}${burnText ? ` · ${burnText}` : ''}`);
    const count = round?.stars ?? level?.stars ?? 0, maximum = earned ? 5 : 6;
    const starsKey = `${count}/${maximum}`;
    if (starsKey !== lastStars) {
      lastStars = starsKey; stars.replaceChildren(); stars.setAttribute('aria-label', `${count} of ${maximum} Funded stars`);
      for (let i = 0; i < maximum; i++) { const star = node('span', i < count ? 'gt-star earned' : 'gt-star', '★'); star.setAttribute('aria-hidden', 'true'); stars.append(star); }
    }
    tier.textContent = round ? round.label.toUpperCase() : level ? `FUNDED · ${level.name.toUpperCase()}` : 'BOOTSTRAPPING';
    rank.textContent = rankText; rank.hidden = !earned;
    radio.textContent = station;
    if (ticker !== lastTicker) {
      lastTicker = ticker; radioTicker.hidden = !ticker; radioTicker.title = ticker;
      radioTicker.replaceChildren(node('span', 'gt-hud-radio-line', ticker));
    }
  }
  update();
  return {
    element: root, update, hideEvent,
    /** Canonical earned funding replaces visit stars only while its feature is enabled. */
    setFundingProfile(profile: FundingProfile, displayedCents = profile.totalCents) {
      if (!flags.fundingLoop || disposed) return false;
      const total = fundingCents(profile.totalCents), display = fundingCents(displayedCents);
      fundingDisplay = { profile, displayedCents: (display > total ? total : display).toString() };
      update(lastInput); return true;
    },
    get cardOpen() { return open; },
    showEvent(event: RadarEvent, attendeeCount?: number) {
      if (disposed) return;
      const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      const focusInCard = card.contains(active);
      shownEvent = event; shareStatus.hidden = true; shareStatus.textContent = '';
      share.hidden = !options.onShareEvent || !Number.isFinite(event.lat) || !Number.isFinite(event.lon);
      title.textContent = event.title;
      const start = Date.parse(event.start); when.textContent = Number.isFinite(start) ? `${eventFormat.format(start)} PT` : 'Time on the event page';
      host.textContent = event.host ? `Hosted by ${event.host}` : ''; host.hidden = !event.host;
      venue.textContent = event.venue || event.address || 'Venue details on the event page';
      approximate.hidden = !event.approx;
      approximate.textContent = 'Approximate neighborhood marker. This is not the event entrance; check the event page for the venue.';
      const hasAttendeeCount = Number.isSafeInteger(attendeeCount) && attendeeCount! >= 0;
      attendance.hidden = !hasAttendeeCount;
      attendance.textContent = hasAttendeeCount
        ? `${attendeeCount} ${attendeeCount === 1 ? 'player' : 'players'} here in GTASF` : '';
      let eventHref: string | undefined;
      try { const url = new URL(event.url); if (url.protocol === 'https:' || url.protocol === 'http:') eventHref = url.href; } catch { /* Malformed source links are not clickable. */ }
      link.hidden = !eventHref;
      if (eventHref) link.href = eventHref; else link.removeAttribute('href');
      if (!open) {
        restoreFocus = active; open = true; card.hidden = false; options.onCardChange?.(true);
        // A fresh opening starts at the heading; live updates retain the reader's place.
        card.scrollTop = 0;
        close.focus({ preventScroll: true });
      } else if (focusInCard && active && !usableControl(active)) close.focus({ preventScroll: true });
    },
    destroy() { if (disposed) return; hideEvent(); disposed = true; document.removeEventListener('keydown', onKey); root.remove(); card.remove(); },
  };
}
export type PlayableHud = NonNullable<ReturnType<typeof createPlayableHud>>;
