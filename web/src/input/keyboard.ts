import { consumesActivationKey, consumesTextKeys, DESKTOP_ACTIONS } from './actions';
import { needsFreeCursor, onCursorModeChange } from './cursor';
import type { Actions, MovementInput } from './actions';
const movementKeys: Readonly<Record<string, number>> = Object.freeze({
  KeyW: 1,
  ArrowUp: 2,
  KeyS: 4,
  ArrowDown: 8,
  KeyA: 16,
  ArrowLeft: 32,
  KeyD: 64,
  ArrowRight: 128,
  ShiftLeft: 256,
  ShiftRight: 512,
});
/** Keyboard and mobile controllers both publish the same move/look/zoom action payloads. */
export function bindKeyboard(
  actions: Actions,
  options: { target?: Window; consumesKeys?: () => boolean } = {},
) {
  const target = options.target ?? window;
  const movement: MovementInput = { x: 0, z: 0, run: false };
  let held = 0;
  function publish(): void {
    movement.x = Number(Boolean(held & 64)) - Number(Boolean(held & 16));
    movement.z = Number(Boolean(held & 4)) - Number(Boolean(held & 1));
    movement.run = Boolean(held & 768);
    actions.emit('move', movement);
  }
  const down = (event: KeyboardEvent) => {
    if (
      event.defaultPrevented ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey ||
      consumesTextKeys(event.target) ||
      consumesActivationKey(event) ||
      options.consumesKeys?.()
    )
      return;
    const bit = movementKeys[event.code];
    if (bit !== undefined) {
      if (needsFreeCursor()) return;
      event.preventDefault();
      if (!(held & bit)) {
        held |= bit;
        publish();
      }
      return;
    }
    if (event.repeat || !Object.hasOwn(DESKTOP_ACTIONS, event.code)) return;
    event.preventDefault();
    actions.emit(DESKTOP_ACTIONS[event.code as keyof typeof DESKTOP_ACTIONS], undefined);
  };
  const up = (event: KeyboardEvent) => {
    const bit = movementKeys[event.code];
    // Releasing a key still clears its state if focus moved into a text field after keydown.
    if (bit !== undefined && held & bit) {
      held &= ~bit;
      publish();
    }
  };
  target.addEventListener('keydown', down);
  target.addEventListener('keyup', up);
  function release(): void {
    if (held) {
      held = 0;
      publish();
    }
  }
  const offRelease = actions.on('releaseInput', release);
  const offCursor = onCursorModeChange(() => {
    if (needsFreeCursor()) release();
  });
  const focus = (event: FocusEvent) => {
    if (consumesTextKeys(event.target)) release();
  };
  target.addEventListener('blur', release);
  target.document.addEventListener('focusin', focus);
  return {
    release,
    poll(dt: number): void {
      const dx = Number(Boolean(held & 128)) - Number(Boolean(held & 32));
      const dy = Number(Boolean(held & 2)) - Number(Boolean(held & 8));
      if (dx || dy) actions.emit('look', { dx: dx * Math.min(.1, dt) * 560, dy: dy * Math.min(.1, dt) * 560 });
    },
    dispose(this: void): void {
      release();
      offRelease();
      offCursor();
      target.removeEventListener('blur', release);
      target.document.removeEventListener('focusin', focus);
      target.removeEventListener('keydown', down);
      target.removeEventListener('keyup', up);
    },
  };
}
