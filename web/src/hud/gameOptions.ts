import './gameOptions.css';
import { isInvertLook, setInvertLook } from '../input/invertLook';
import { setTimeOfDay, activeTimeOfDayPreset, TIME_OF_DAY_PRESETS } from '../render/timeOverride';
import { activeGraphicsMode, graphicsMode, setGraphics, type GraphicsMode } from '../render/graphicsPreset';

function node<K extends keyof HTMLElementTagNameMap>(tag: K, text = '') {
  const element = document.createElement(tag); element.textContent = text; return element;
}

/** An explicit menu choice supersedes a link's renderer override, retaining its destination. */
function clearUrlOverrides(keys: readonly string[]): boolean {
  const url = new URL(location.href);
  const changed = keys.some(key => url.searchParams.has(key));
  if (changed) {
    for (const key of keys) url.searchParams.delete(key);
    history.replaceState(history.state, '', url);
  }
  return changed;
}

/** One existing toolbar slot holds the growing optional controls on desktop and phones. */
export function createGameOptions(options: {
  launcher: HTMLButtonElement;
  tankControls(): boolean;
  toggleMovement(): void;
  outfit?: { label(): string; next(): void };
  recover?: () => void;
  recenter?: () => void;
  changelog?: () => void;
  onModalChange(open: boolean): void;
}) {
  const { launcher } = options;
  launcher.textContent = 'Game options'; launcher.title = 'Movement, outfit and city options';
  launcher.removeAttribute('aria-pressed'); launcher.setAttribute('aria-haspopup', 'dialog');
  const dialog = node('dialog'); dialog.className = 'gt-game-options'; dialog.setAttribute('aria-label', 'Game options');
  const header = node('header'), title = node('h2', 'Game options'), close = node('button', 'Close ×'); close.type = 'button';
  header.append(title, close);
  const movement = node('button'); movement.type = 'button';
  const invertLook = node('button'); invertLook.type = 'button';
  const outfit = options.outfit ? node('button') : null;
  if (outfit) outfit.type = 'button';
  const recenter = options.recenter ? node('button', 'Recenter view') : null;
  if (recenter) recenter.type = 'button';
  const recover = options.recover ? node('button', 'Return to road · R') : null;
  if (recover) recover.type = 'button';
  const controls = node('section'); controls.className = 'gt-game-options-controls'; controls.append(movement, invertLook);
  if (outfit) controls.append(outfit);
  if (recenter) controls.append(recenter);
  if (recover) controls.append(recover);
  const changelog = options.changelog ? node('button', "What's new · Changelog") : null;
  if (changelog) { changelog.type = 'button'; controls.append(changelog); }
  const content = node('div'); content.className = 'gt-game-options-extra';
  // Time-of-day comparison (pane 9, founder evening review): pin the SA grade to a look, or Live =
  // real SF clock. Lets testers/the founder compare looks and players opt out of a dull real-time
  // grade. Applies LIVE (the render foundation re-reads the setting each frame, so the grade changes
  // within a frame — no reload); the URL `?time=noon|golden|dusk|night` does the same.
  const timeOfDay = node('section'); timeOfDay.className = 'gt-game-options-timeofday';
  const timeLabel = node('span', 'Time of day'); timeLabel.className = 'gt-game-options-timeofday-label';
  const timeButtons = node('div'); timeButtons.className = 'gt-game-options-timeofday-buttons';
  for (const preset of TIME_OF_DAY_PRESETS) {
    const choice = node('button', preset.label); choice.type = 'button';
    choice.dataset.timePreset = preset.value;
    choice.addEventListener('click', () => {
      clearUrlOverrides(['time', 'hour']);
      setTimeOfDay(preset.value);
      refresh();
    });
    timeButtons.append(choice);
  }
  timeOfDay.append(timeLabel, timeButtons);
  // Graphics quality (pane 9, realistic renderer): HD (realistic) / Low (fast) / Auto (device-picked,
  // auto-downgrades on sustained low FPS). A quality change re-initialises the renderer, so this
  // applies on reload; the URL `?gfx=hd|low` overrides for testing.
  const graphics = node('section'); graphics.className = 'gt-game-options-timeofday';
  const graphicsLabel = node('span', 'Graphics'); graphicsLabel.className = 'gt-game-options-timeofday-label';
  const graphicsButtons = node('div'); graphicsButtons.className = 'gt-game-options-timeofday-buttons';
  const graphicsModes: { value: GraphicsMode; label: string }[] = [
    { value: 'auto', label: 'Auto' }, { value: 'hd', label: 'HD' }, { value: 'low', label: 'Low' },
  ];
  for (const mode of graphicsModes) {
    const choice = node('button', mode.label); choice.type = 'button';
    choice.dataset.graphicsMode = mode.value;
    choice.addEventListener('click', () => {
      const hadOverride = clearUrlOverrides(['gfx', 'preset']);
      if (graphicsMode() === mode.value && !hadOverride) { hide(); return; }
      setGraphics(mode.value);
      try { location.reload(); } catch { /* non-browser */ }
    });
    graphicsButtons.append(choice);
  }
  graphics.append(graphicsLabel, graphicsButtons);
  const status = node('p'); status.className = 'gt-game-options-status'; status.setAttribute('role', 'status'); status.hidden = true;
  const hint = node('p', 'WASD move / drive · Arrows look · C recenter · E enter / exit'); hint.className = 'gt-game-options-hint';
  dialog.append(header, controls, timeOfDay, graphics, content, status, hint); document.body.append(dialog);
  let disposed = false, announcedOpen = false;
  function refresh() {
    const activeGraphics = activeGraphicsMode();
    for (const choice of graphicsButtons.querySelectorAll<HTMLButtonElement>('button')) {
      choice.setAttribute('aria-pressed', String(choice.dataset.graphicsMode === activeGraphics));
    }
    const activeTime = activeTimeOfDayPreset();
    for (const choice of timeButtons.querySelectorAll<HTMLButtonElement>('button')) {
      choice.setAttribute('aria-pressed', String(choice.dataset.timePreset === activeTime));
    }
    movement.textContent = `On foot: ${options.tankControls() ? 'tank controls' : 'camera relative'}`;
    movement.setAttribute('aria-pressed', String(options.tankControls()));
    invertLook.textContent = `Invert look: ${isInvertLook() ? 'on' : 'off'}`;
    invertLook.setAttribute('aria-pressed', String(isInvertLook()));
    if (outfit && options.outfit) outfit.textContent = `Outfit: ${options.outfit.label()} · O`;
  }
  function hide() { if (dialog.open) dialog.close(); onClose(); }
  function open() {
    if (disposed || dialog.open) return;
    onClose();
    status.hidden = true; status.textContent = '';
    refresh(); announcedOpen = true; options.onModalChange(true); dialog.showModal(); close.focus({ preventScroll: true });
  }
  function onClose() {
    // Native dialog focus restoration is synchronous. Its queued close event
    // must not release a reopened panel or override a newer non-native HUD.
    if (dialog.open || !announcedOpen) return;
    announcedOpen = false; options.onModalChange(false);
  }
  // Browsers omit click for a secondary finger while the movement stick holds the primary one.
  const onSecondaryTouch = (event: PointerEvent) => {
    if (event.pointerType !== 'touch' || event.isPrimary) return;
    event.preventDefault(); open();
  };
  launcher.addEventListener('pointerdown', onSecondaryTouch);
  launcher.addEventListener('click', open); close.addEventListener('click', hide);
  movement.addEventListener('click', () => { options.toggleMovement(); refresh(); });
  invertLook.addEventListener('click', () => { setInvertLook(!isInvertLook()); refresh(); });
  outfit?.addEventListener('click', () => { options.outfit?.next(); refresh(); });
  recover?.addEventListener('click', () => { hide(); options.recover?.(); });
  changelog?.addEventListener('click', () => { hide(); options.changelog?.(); });
  recenter?.addEventListener('click', () => { hide(); options.recenter?.(); });
  dialog.addEventListener('close', onClose);
  dialog.addEventListener('cancel', event => { event.preventDefault(); hide(); });
  refresh();
  return { content, open, hide, refresh, setStatus(message: string) { status.textContent = message; status.hidden = !message; }, get modalOpen() { return dialog.open; },
    destroy() {
      if (disposed) return; disposed = true;
      hide();
      dialog.removeEventListener('close', onClose); launcher.removeEventListener('click', open);
      launcher.removeEventListener('pointerdown', onSecondaryTouch); dialog.remove();
    },
  };
}
