/**
 * Founder-ladder HUD lock (PLAN step 1: new players see only the minimap + ONE quest card; the
 * crown/OUTBID banner, the $ counter, the stars, radio, drops and chat are hidden until they unlock).
 *
 * Reuses the onboarding progressive-reveal pattern (web/src/onboarding/hudReveal.ts) — one stylesheet
 * keyed on a body data-attribute, hiding panels by selector with no panel-module changes — and pulls
 * hudReveal's own PANEL_SELECTORS so the map/events/chat/etc. selectors stay in sync with onboarding.
 * On top of those it hides the full status block (.gt-hud: money/stars/radio/tier/rank) and the
 * funding controls, which onboarding never hides. The minimap (radar) and this lane's own quest card
 * / valuation pill are never matched, so they stay visible. Removing the attribute restores the HUD.
 */
import { PANEL_SELECTORS } from '../onboarding/hudReveal';

/** Panels hudReveal knows about that the founder ladder also hides while locked (everything but radar/funding). */
const REUSED_PANELS = ['map', 'events', 'vcDrop', 'outbid', 'chat', 'wardrobe', 'friends'] as const;

/** Extra selectors onboarding never hides: the status block, the funding buttons, the control-hints
 *  footer (the controls are revealed later) and the radar's nearest-live event ticker (event flavour,
 *  shown after Seed), so a new player sees only the minimap and the one quest card. */
const EXTRA_HIDDEN = ['.gt-hud', '.gt-funding-controls', '#keyboard-help', '.gt-pause-hint',
  '.gt-radar-ticker', '.gt-radio-next',
  // The earned-crown banner is a free-roam element: hidden through the found → Seed spine, shown after unlock.
  '.gt-founder-crown'];

const LOCK_ATTR = 'data-founder-locked';
/** actionOpening: while the Seed step is a DRIVE, the 'E · Get in and drive' prompt must show (review M1). */
const DRIVE_ATTR = 'data-founder-drive';
/** actionOpening (critic N8): the billboard reveal is a hero shot — the phone's thumb chrome stands aside for it. */
const REVEAL_ATTR = 'data-founder-reveal';
/** Floating phone chrome that sits over the reveal (mic + its pill, the 🎨 paint button); pitchConversation.css hides the same set while a conversation is open. */
const THUMB_CHROME = '.gt-voice-ptt, .gt-voice-pill, .gt-voice-status, #mayhem-fire, #mayhem-item';

function lockedSelectors(): string[] {
  const out = [...EXTRA_HIDDEN];
  for (const panel of REUSED_PANELS) out.push(...PANEL_SELECTORS[panel]);
  return out;
}

let installed = false;
function install(): void {
  if (installed) return;
  installed = true;
  const style = document.createElement('style');
  style.dataset.founder = 'hud-lock';
  style.textContent = `body[${LOCK_ATTR}] :is(${lockedSelectors().join(',')}) { display: none !important; }
body[${LOCK_ATTR}]:not([${DRIVE_ATTR}]) #prompt { display: none !important; }
body[${REVEAL_ATTR}] :is(${THUMB_CHROME}) { display: none !important; }`;
  document.head.append(style);
}

/** Close any open funding identity/leaderboard modal when the lock applies. These open via showModal(),
 *  which puts the dialog in the top layer and makes the REST of the document inert — and a modal stays
 *  inert even at display:none, so CSS-hiding it (the old backstop) left the Found-it card unclickable
 *  (elementFromPoint over it returned <html>, "<html> intercepts pointer events"). close() frees the top
 *  layer. The openIdentity() guard (funding/hud.ts) stops it reopening while locked; this handles it
 *  already being open at lock time (the identity dialog can open before the founder controller mounts). */
function closeInertingFundingDialogs(): void {
  for (const dialog of document.querySelectorAll<HTMLDialogElement>('dialog.gt-funding-dialog[open]')) {
    try { dialog.close(); } catch { /* detached or mid-transition */ }
  }
}

/** Hide everything but the minimap and this lane's quest card / valuation pill. */
export function applyFounderLock(body: HTMLElement = document.body): void {
  install();
  body.setAttribute(LOCK_ATTR, '');
  closeInertingFundingDialogs();
}

/** Restore the full HUD (returning player, or a later stage unlocks free roam). */
export function releaseFounderLock(body: HTMLElement = document.body): void {
  body.removeAttribute(LOCK_ATTR);
}

export function isFounderLocked(body: HTMLElement = document.body): boolean {
  return body.hasAttribute(LOCK_ATTR);
}

/** actionOpening (review M1): let the interaction prompt ('E · Get in and drive') through the lock during the Seed drive. */
export function setFounderLockDrive(on: boolean, body: HTMLElement = document.body): void {
  if (on) body.setAttribute(DRIVE_ATTR, ''); else body.removeAttribute(DRIVE_ATTR);
}

/** actionOpening (critic N8): hide the phone thumb chrome while the camera swings to the player's billboard. */
export function setFounderReveal(on: boolean, body: HTMLElement = document.body): void {
  install();
  if (on) body.setAttribute(REVEAL_ATTR, ''); else body.removeAttribute(REVEAL_ATTR);
}
