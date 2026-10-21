import { flags } from '@gtasf/shared/flags';
import { consumesTextKeys } from '../input/actions';
import './pauseMenu.css';
import './hudFocus.css';

/** Reparent live controls so listeners, server updates and onboarding locks survive. */
export function createPauseMenu(options: {
  canOpen(): boolean; onChange(open: boolean): void; onHorn(): void; onChangelog?(): void;
  /** Open the jobs phone (missions + SF pilgrimage); omitted → no button. */
  onJobs?(): void;
}) {
  if (!flags.hud) return null;
  const button = document.createElement('button');
  button.className = 'gt-pause-launch'; button.type = 'button'; button.textContent = '☰';
  button.setAttribute('aria-label', 'Open pause menu'); button.setAttribute('aria-expanded', 'false');
  const dialog = document.createElement('dialog'); dialog.className = 'gt-pause-menu';
  dialog.setAttribute('aria-label', 'Pause menu');
  const heading = document.createElement('h2'); heading.textContent = 'San Francisco';
  const resume = document.createElement('button'); resume.type = 'button'; resume.textContent = 'Resume · Esc';
  dialog.append(heading, resume);
  const legend = document.createElement('p'); legend.className = 'gt-pause-key-legend';
  legend.textContent = `C recenter camera${flags.feedback ? ' · K feedback' : ''}${flags.radio && flags.radioStations ? ' · [ ] radio stations' : ''}`;
  dialog.append(legend);
  const moved: { element: HTMLElement; anchor: Comment }[] = [];
  for (const [title, selectors] of [
    ['Playtest feedback', ['.gt-feedback-launch']],
    ['City actions', ['#play-controls']],
    ['Tech Week', ['.gt-radar-head > button:first-child', '.gt-upcoming-open', '.gt-eventsubmit-open', ...(flags.hudMenuFold ? ['.gt-radar-ticker'] : [])]],
    ['Your startup', ['.gt-funding-controls', '.gt-hud-tier', '.gt-hud-rank']],
    ['Friends and sharing', ['.gt-referral-launch', '.gt-chat-launch']],
    ['Current trip', ['.gt-gps-status', '#trip-status']],
    ['Radio', ['.gt-hud-radio', '.gt-hud-radio-ticker', ...(flags.hudMenuFold ? ['.gt-radio-next'] : [])]], // critic R5: phone STATION folds in
    ['Controls and connection', ['#keyboard-help', '#app > aside', '.gt-creator--hud']],
  ] as const) {
    const section = document.createElement('section'), label = document.createElement('h3');
    section.className = 'gt-pause-group'; label.textContent = title; section.append(label);
    for (const selector of selectors) {
      const element = document.querySelector<HTMLElement>(selector);
      if (!element?.parentNode) continue;
      const anchor = document.createComment('pause control home'); element.before(anchor);
      moved.push({ element, anchor }); section.append(element);
    }
    if (section.children.length > 1) dialog.append(section);
  }
  if (options.onJobs) { // one tap from the HUD on phones (no N key there)
    const jobs = document.createElement('button'); jobs.type = 'button'; jobs.textContent = 'Phone: jobs & SF pilgrimage';
    jobs.addEventListener('click', () => { hide(); options.onJobs?.(); }); dialog.append(jobs);
  }
  const horn = document.createElement('button'); horn.type = 'button'; horn.textContent = 'Horn';
  horn.addEventListener('click', () => options.onHorn()); dialog.append(horn);
  if (flags.changelog && options.onChangelog) {
    const changelog = document.createElement('button'); changelog.type = 'button'; changelog.textContent = "What's new · Changelog";
    changelog.addEventListener('click', () => { hide(); options.onChangelog?.(); }); dialog.append(changelog);
  }
  // hudMenuFold (critique #6): the analytics Privacy button leaves the HUD; this opens the same consent panel. It boots
  // async (and only when analytics is configured), so the menu button shows only while that control exists.
  const privacy = flags.hudMenuFold ? document.createElement('button') : null;
  if (privacy) {
    privacy.type = 'button'; privacy.textContent = 'Privacy settings'; privacy.hidden = true;
    privacy.addEventListener('click', () => { hide(); document.querySelector<HTMLButtonElement>('.gt-privacy-launch')?.click(); });
    dialog.append(privacy); document.body.classList.add('gt-hud-fold');
  }
  const hint = document.createElement('p'); hint.className = 'gt-pause-hint';
  hint.hidden = true;
  let disposed = false;
  document.body.append(button, dialog, hint); document.body.classList.add('gt-hud-minimal');
  if (flags.hudFocus) document.body.classList.add('gt-hud-focus'); // critic N2/N4: one message at a time (hudFocus.css)
  if (flags.hudFocus && flags.questYieldsToPayout) document.body.classList.add('gt-quest-yields'); // critic N42
  // hudDeclutter: the key legend is a reminder, not furniture. Shown for LEGEND_FIRST_MS after it first appears, then
  // only for LEGEND_AGAIN_MS after the mode changes (you got into a car) or the pause menu closes (you just read the keys).
  const LEGEND_FIRST_MS = 25_000, LEGEND_AGAIN_MS = 10_000;
  let legendUntil = -1, legendMode: string | undefined;
  function hide() {
    if (!dialog.open) return;
    dialog.close(); button.setAttribute('aria-expanded', 'false'); options.onChange(false);
    button.focus({ preventScroll: true });
    if (flags.hudDeclutter) legendUntil = performance.now() + LEGEND_AGAIN_MS;
  }
  function show() {
    if (disposed || dialog.open || !options.canOpen()) return;
    if (privacy) privacy.hidden = !document.querySelector('.gt-privacy-launch');
    dialog.showModal(); button.setAttribute('aria-expanded', 'true'); hint.hidden = true;
    options.onChange(true); resume.focus({ preventScroll: true });
  }
  const key = (event: KeyboardEvent) => {
    if (disposed || event.key !== 'Escape' || event.repeat || event.isComposing || event.keyCode === 229) return;
    // Inline chat owns Escape until its composer closes; do not steal it in capture.
    if (!dialog.open && consumesTextKeys(event.target)) return;
    if (!dialog.open && (!options.canOpen() || document.querySelector('dialog[open]'))) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (dialog.open) hide(); else show();
  };
  const cancel = (event: Event) => { event.preventDefault(); hide(); };
  // Capture runs before each original action handler, releasing the modal guard first.
  const choose = (event: MouseEvent) => {
    if (event.target instanceof Element && event.target.closest('button,a[href]')) hide();
  };
  button.addEventListener('click', show); resume.addEventListener('click', hide);
  dialog.addEventListener('cancel', cancel); dialog.addEventListener('click', choose, true);
  window.addEventListener('keydown', key, true);
  return {
    element: dialog, show, hide, get isOpen() { return dialog.open; },
    update(allowed: boolean, mode: 'on-foot' | 'driver' | 'passenger' = 'on-foot', touch = false, riding = false) {
      const travel = `${flags.robotaxi ? 'H robotaxi · ' : ''}M map`;
      const text = mode === 'passenger' ? 'E exit · M map · Esc menu'
        : mode === 'driver'
          ? `W/S drive · Space brake · E exit${flags.radioStations ? ' · [ ] radio' : ''}\n${travel} · Esc menu`
          : riding
            ? `G put away · ${travel} · Esc menu`
            : `Shift run${flags.combat && flags.weapons ? ' · F shoot · Tab guns' : ''} · E enter${flags.personalRides ? ' · G ride' : ''}\n${travel} · ${flags.proximityVoice ? 'J' : 'V'} events${flags.missions ? ' · N jobs' : ''}${flags.chat ? ' · T chat' : ''} · Esc menu`;
      if (hint.textContent !== text) hint.textContent = text;
      let hidden = !allowed || touch || dialog.open;
      if (flags.hudDeclutter && !hidden) {
        const now = performance.now(), modeKey = `${mode}:${riding}`;
        if (legendUntil < 0) legendUntil = now + LEGEND_FIRST_MS;                      // first appearance
        else if (legendMode !== undefined && modeKey !== legendMode) legendUntil = Math.max(legendUntil, now + LEGEND_AGAIN_MS); // new keys apply
        legendMode = modeKey;
        hidden = now >= legendUntil;
      }
      if (hint.hidden !== hidden) hint.hidden = hidden;
    },
    destroy() {
      if (disposed) return; hide(); disposed = true;
      window.removeEventListener('keydown', key, true);
      for (const { element, anchor } of moved) { anchor.after(element); anchor.remove(); }
      dialog.remove(); button.remove(); hint.remove(); document.body.classList.remove('gt-hud-minimal', 'gt-hud-fold', 'gt-hud-focus', 'gt-quest-yields');
    },
  };
}
