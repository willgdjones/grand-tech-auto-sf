/**
 * Progressive HUD reveal (PLAN-onboarding.md decision 5, gtasf-n34i). New players start with radar +
 * funding only; the tutorial reveals the rest. Panels are owned by many modules with no uniform
 * setVisible, so this hides them by selector from one stylesheet keyed on a body data attribute —
 * no panel module changes, and removing the attribute restores everything.
 */
import type { HudPanel } from '@gtasf/shared/onboarding/state';

/** Selectors hidden while a panel is still locked. radar + funding are never hidden. */
export const PANEL_SELECTORS: Readonly<Record<HudPanel, readonly string[]>> = {
  radar: [],
  funding: [],
  // The map (M) arrives with the GPS step, along with the quick-destination row and hail button.
  map: ['#map-toggle', '.gt-radar-head button[aria-label="Open event map"]', '.trip-label', '#destination-lombard', '#destination-ferry', '#hail', '#trip-status',
    '.gtasf-touch button[data-action="map"]', '.gtasf-touch button[data-action="hail"]', '.gt-gps-status'],
  events: ['.gt-upcoming-open'],
  vcDrop: ['.gt-drop-banner', '.gt-drop-toast'],
  outbid: ['.gt-outbid-banner'],
  chat: ['.gt-chat-launch', '.gt-chat-ambient'],
  wardrobe: ['.gt-wardrobe-launch'],
  friends: ['.gt-friends-launch'],
};

/** The long keyboard-help line is replaced by mission text until the tutorial finishes. */
const TUTORIAL_ONLY_HIDDEN = ['#keyboard-help'];

export function revealCss(): string {
  const rules = (Object.entries(PANEL_SELECTORS) as [HudPanel, readonly string[]][])
    .filter(([, selectors]) => selectors.length)
    .map(([panel, selectors]) => `${selectors.map(s => `body[data-onb-locked~="${panel}"] ${s}`).join(',\n')} { display: none !important; }`);
  rules.push(`${TUTORIAL_ONLY_HIDDEN.map(s => `body[data-onb-locked] ${s}`).join(',')} { display: none !important; }`);
  return rules.join('\n');
}

/** The data attribute value for a set of visible panels (space-separated locked panel ids). */
export function lockedAttribute(visible: readonly HudPanel[]): string {
  return (Object.keys(PANEL_SELECTORS) as HudPanel[]).filter(panel => !visible.includes(panel) && PANEL_SELECTORS[panel].length).join(' ');
}

let installed = false;
/** Apply the reveal: hide exactly the locked panels (none once everything is visible). */
export function applyHudReveal(visible: readonly HudPanel[], body: HTMLElement = document.body): void {
  if (!installed) {
    installed = true;
    const style = document.createElement('style'); style.dataset.onboarding = 'hud-reveal'; style.textContent = revealCss();
    document.head.append(style);
  }
  const locked = lockedAttribute(visible);
  if (locked) body.setAttribute('data-onb-locked', locked); else body.removeAttribute('data-onb-locked');
}
