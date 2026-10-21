import './phoneHud.css';
import { flags } from '@gtasf/shared/flags';

/** Move the original controls, preserving their listeners, state and accessible names. */
export function createPhoneHud(options: { parent: HTMLElement; closeOptions(): void; enabled: boolean; minimal?: boolean }) {
  if (!options.enabled) return null;
  const narrow = matchMedia('(max-width: 700px)');
  const short = matchMedia('(max-height: 700px)');
  const low = matchMedia('(max-height: 500px)');
  const landscape = matchMedia('(orientation: landscape)');
  const touch = navigator.maxTouchPoints > 0 || matchMedia('(pointer: coarse)').matches;
  const isPhone = () => narrow.matches || (touch && low.matches);
  const menu = document.createElement('section'); menu.className = 'gt-phone-menu'; menu.hidden = true;
  menu.setAttribute('aria-label', 'City actions');
  const moved: { element: HTMLElement; anchor: Comment; group: HTMLElement; compactOnly: boolean }[] = [];
  for (const [title, selectors, compactOnly] of [
    ['Getting around', ['#enter-exit', '#ride', '#hail', '#map-toggle'], false],
    ['Events and chat', ['.gt-upcoming-open', '.gt-chat-launch'], true],
    ['Current location', ['.gt-street-hud'], true],
    ['Tech Week', ['.gt-eventsubmit-open'], false],
    ['Mayhem', ['#mayhem-item'], false],
    ['Quick destinations', ['#destination-lombard', '#destination-ferry'], false],
    ['Your startup', ['.gt-funding-controls'], false],
    ['Sharing', ['#share-location', '.gt-referral-launch'], false],
    ['City sponsor', ['.gt-outbid-banner > .gt-outbid-board-button'], false],
  ] as const) {
    if (options.minimal) continue;
    const group = document.createElement('section'), heading = document.createElement('h3');
    heading.textContent = title; group.append(heading); group.className = 'gt-phone-menu-group';
    for (const selector of selectors) {
      const element = document.querySelector<HTMLElement>(selector);
      if (!element?.parentNode) continue;
      const anchor = document.createComment('phone control home'); element.before(anchor);
      moved.push({ element, anchor, group, compactOnly });
    }
    if (moved.some(entry => entry.group === group)) menu.append(group);
  }
  options.parent.prepend(menu);
  // The live fund notice wraps differently by fund name, teaser and phone width.
  // Reserve its rendered height only when it is visible; never measure per frame.
  const dropBanner = document.querySelector<HTMLElement>('.gt-drop-banner');
  let noticeHeight = -1, disposed = false;
  const noticeNext = () => { const height = isPhone() && dropBanner ? Math.ceil(dropBanner.getBoundingClientRect().height) : 0; return height > 0 ? height + 8 : 0; };
  function reserveNoticeSpace(measured?: number) {
    if (disposed) return;
    const next = typeof measured === 'number' ? measured : noticeNext();
    if (next === noticeHeight) return;
    noticeHeight = next;
    document.body.style.setProperty('--gt-phone-notice-height', `${next}px`);
  }
  const noticeObserver = dropBanner ? new ResizeObserver(() => reserveNoticeSpace()) : null;
  if (dropBanner) noticeObserver?.observe(dropBanner);
  // Driving adds action rows. Keep notices above the actual control stack.
  const touchActions = document.querySelector<HTMLElement>('.gtasf-touch .buttons');
  let actionsHeight = -1;
  const actionsNext = () => touchActions ? Math.ceil(touchActions.getBoundingClientRect().height) : 0;
  function reserveActionSpace(measured?: number) {
    if (disposed) return;
    const next = typeof measured === 'number' ? measured : actionsNext();
    if (next === actionsHeight) return;
    actionsHeight = next;
    document.body.style.setProperty('--gt-touch-actions-height', `${next}px`);
  }
  const actionObserver = touchActions ? new ResizeObserver(() => reserveActionSpace()) : null;
  if (touchActions) actionObserver?.observe(touchActions);
  // Follow the full desktop header/actions so wrapped controls and contextual
  // hints stay distinct. Observe layout changes instead of reading every frame.
  const toolbar = document.querySelector<HTMLElement>('#play-controls');
  const header = document.querySelector<HTMLElement>('#app>header');
  const sponsor = document.querySelector<HTMLElement>('.gt-outbid-banner');
  let toolbarBottom = -1;
  const toolbarNext = () => !isPhone() ? Math.ceil(Math.max(toolbar?.getBoundingClientRect().bottom ?? 0,
    header?.getBoundingClientRect().bottom ?? 0)) : 0;
  function reserveToolbarSpace(measured?: number) {
    if (disposed) return;
    const next = typeof measured === 'number' ? measured : toolbarNext();
    if (next === toolbarBottom) return;
    toolbarBottom = next;
    document.body.style.setProperty('--gt-desktop-controls-bottom', `${next}px`);
  }
  const toolbarObserver = toolbar || header ? new ResizeObserver(() => reserveToolbarSpace()) : null;
  if (toolbar) toolbarObserver?.observe(toolbar);
  if (header) toolbarObserver?.observe(header);
  if (sponsor) toolbarObserver?.observe(sponsor);
  if (dropBanner) toolbarObserver?.observe(dropBanner);
  function update() {
    const phone = isPhone(), compact = phone && short.matches;
    document.body.classList.toggle('gt-phone-hud', phone);
    document.body.classList.toggle('gt-compact-hud', compact);
    document.body.classList.toggle('gt-landscape-hud', compact && landscape.matches);
    menu.hidden = options.minimal || !phone;
    for (const { element, anchor, group, compactOnly } of moved) {
      if (phone && (!compactOnly || compact)) group.append(element);
      else anchor.after(element);
    }
    for (const group of menu.children) if (group instanceof HTMLElement)
      group.hidden = !moved.some(entry => entry.group === group && entry.element.parentElement === group);
    if (flags.hudBatchedReads) {
      // Read all three, then write: each write (a CSS variable on body) invalidated layout for the next read, so a cold 4x phone
      // paid 2-3 full layouts here at boot (reserveActionSpace 418 ms self, LT_TOP 10-20). Sizes a write changes are corrected
      // by the ResizeObservers above.
      const notice = noticeNext(), actions = actionsNext(), toolbarBottomNext = toolbarNext();
      reserveNoticeSpace(notice); reserveActionSpace(actions); reserveToolbarSpace(toolbarBottomNext);
    } else { reserveNoticeSpace(); reserveActionSpace(); reserveToolbarSpace(); }
  }
  const select = (event: MouseEvent) => {
    const target = event.target instanceof Element ? event.target.closest('button') : null;
    if (target && isPhone()) options.closeOptions();
  };
  // A panel opened by a moved button must return focus to a visible control.
  const close = () => queueMicrotask(() => {
    const active = document.activeElement;
    if (isPhone() && !document.querySelector('dialog[open]') &&
      (active === document.body || !active?.checkVisibility({ visibilityProperty: true })))
      document.querySelector<HTMLButtonElement>('#movement-mode')?.focus({ preventScroll: true });
  });
  menu.addEventListener('click', select); document.addEventListener('close', close, true);
  const queries = [narrow, short, low, landscape];
  for (const query of queries) query.addEventListener('change', update);
  update();
  return {
    destroy() {
      if (disposed) return; disposed = true;
      for (const query of queries) query.removeEventListener('change', update);
      menu.removeEventListener('click', select);
      noticeObserver?.disconnect(); document.body.style.removeProperty('--gt-phone-notice-height');
      actionObserver?.disconnect(); document.body.style.removeProperty('--gt-touch-actions-height');
      toolbarObserver?.disconnect(); document.body.style.removeProperty('--gt-desktop-controls-bottom');
      document.removeEventListener('close', close, true);
      for (const { element, anchor } of moved) { anchor.after(element); anchor.remove(); }
      menu.remove(); document.body.classList.remove('gt-phone-hud', 'gt-compact-hud', 'gt-landscape-hud');
    },
  };
}
