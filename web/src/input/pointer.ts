import './pointer.css';
import { consumesTextKeys } from './actions';
import type { Actions } from './actions';
import { needsFreeCursor, onCursorModeChange } from './cursor';
import { cameraMode, onCameraModeChange } from '../camera/cameraState';
import { flags } from '@gtasf/shared/flags';
import { aimCaptures, setPointerAimState } from './aimCapture';

/** Click captures; a captured click picks at the reticle and releases for interaction. */
export function bindPointer(canvas: HTMLCanvasElement, actions: Actions) {
  const document = canvas.ownerDocument,
    target = document.defaultView!;
  let pointer: number | undefined,
    button = -1,
    startX = 0,
    startY = 0,
    lastX = 0,
    lastY = 0;
  let dragged = false,
    suppressClick = false,
    locked = false,
    wanted = false,
    pending = false,
    awaitingNative = false;
  let attempted = false;
  let fallback = typeof canvas.requestPointerLock !== 'function',
    disposed = false;
  let escapeHeld = false,
    unexpectedUnlockUntil = 0;
  // aimControls: once the browser has granted a lock, a later refusal is transient (Chrome refuses a re-lock for ~1 s
  // after Esc), so the next click retries instead of dropping into drag-look for the rest of the session.
  let everLocked = false;
  // hudDeclutter: the arrow-keys/drag fallback hint used to stay on screen for the whole session once pointer lock
  // was refused. Show it for HINT_MS after each refused attempt instead, then let the player's hands remember.
  const HINT_MS = 8_000;
  let hintUntil = 0,
    hintTimer: ReturnType<typeof setTimeout> | undefined;
  const reticle = document.createElement('span'),
    hint = document.createElement('p');
  reticle.dataset.lookReticle = '';
  reticle.setAttribute('aria-hidden', 'true');
  reticle.textContent = '+';
  reticle.style.cssText =
    'position:fixed;transform:translate(-50%,-50%);color:white;text-shadow:0 1px 3px black;pointer-events:none;z-index:20;font:24px monospace';
  hint.dataset.lookFallback = '';
  hint.setAttribute('role', 'status');
  const coarse = typeof matchMedia === 'function' && (matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0);
  hint.textContent = coarse ? 'Drag to look around.' : 'Use arrow keys to look · C to recenter. Mouse drag is also available.';
  hint.className = 'gt-look-fallback';
  reticle.hidden = hint.hidden = true;
  document.body.append(reticle, hint);
  const blocked = () =>
    needsFreeCursor() || consumesTextKeys(document.activeElement) || cameraMode() !== 'THIRD_PERSON';
  function draw(): void {
    if (flags.aimControls) setPointerAimState(locked, fallback);
    reticle.hidden = !locked;
    hint.hidden = !fallback || !attempted || blocked() || (flags.hudDeclutter && performance.now() >= hintUntil);
    if (locked) {
      const rect = canvas.getBoundingClientRect();
      reticle.style.left = `${rect.left + rect.width / 2}px`;
      reticle.style.top = `${rect.top + rect.height / 2}px`;
    }
  }
  function clearDrag(): void {
    const captured = pointer;
    pointer = undefined;
    button = -1;
    if (captured !== undefined && canvas.hasPointerCapture(captured)) canvas.releasePointerCapture(captured);
  }
  function release(): void {
    wanted = pending = false;
    clearDrag();
    actions.emit('releaseInput', undefined);
    if (document.pointerLockElement === canvas) document.exitPointerLock();
  }
  function removeLockEvents(): void {
    document.removeEventListener('pointerlockchange', changed);
    document.removeEventListener('pointerlockerror', denied);
  }
  function denied(): void {
    awaitingNative = false;
    if (disposed) {
      removeLockEvents();
      return;
    }
    if (!pending) return;
    wanted = pending = false;
    if (flags.aimControls && everLocked) { draw(); return; } // transient refusal: the next click asks again
    fallback = true;
    if (flags.hudDeclutter) {
      hintUntil = performance.now() + HINT_MS;
      clearTimeout(hintTimer);
      hintTimer = setTimeout(() => { if (!disposed) draw(); }, HINT_MS + 20);
    }
    draw();
  }
  function request(): void {
    if (disposed || blocked() || awaitingNative) return;
    clearDrag();
    attempted = true;
    wanted = pending = awaitingNative = true;
    try {
      const result = canvas.requestPointerLock();
      // Older browsers return void; both their error event and promise refusal share the fallback.
      void Promise.resolve(result).catch(denied);
    } catch {
      denied();
    }
  }
  const changed = () => {
    if (disposed) {
      awaitingNative = false;
      if (document.pointerLockElement === canvas) document.exitPointerLock();
      removeLockEvents();
      return;
    }
    const wasLocked = locked;
    locked = document.pointerLockElement === canvas;
    if (locked) awaitingNative = false;
    if (locked && (!wanted || blocked())) {
      release();
      return;
    }
    if (locked) {
      pending = fallback = false;
      everLocked = true;
      clearDrag();
    } else if (wasLocked) {
      // Some browsers release on Esc before delivering its key event to the page.
      if (wanted) unexpectedUnlockUntil = performance.now() + 250;
      wanted = pending = false;
      clearDrag();
      actions.emit('releaseInput', undefined);
    }
    draw();
  };
  const sync = () => {
    if (blocked()) release();
    draw();
  };
  const offCursor = onCursorModeChange(sync),
    offMode = onCameraModeChange(sync);
  const offLock = actions.on('pointerLock', () => {
    if (locked) release();
    else request();
  });
  const down = (event: PointerEvent) => {
    if (event.pointerType === 'touch') {
      suppressClick = true;
      return;
    }
    suppressClick = false;
    // aimControls: right mouse (hold to aim) captures the mouse too, so aiming never needs a separate click first.
    if (flags.aimControls && event.button === 2 && !locked && !fallback && !blocked() && aimCaptures()) {
      event.preventDefault();
      request();
      return;
    }
    if (
      blocked() ||
      !fallback ||
      locked ||
      pointer !== undefined ||
      (event.button !== 0 && event.button !== 2)
    )
      return;
    pointer = event.pointerId;
    button = event.button;
    startX = lastX = event.clientX;
    startY = lastY = event.clientY;
    dragged = false;
    canvas.setPointerCapture(pointer);
    if (button === 2) event.preventDefault();
  };
  const move = (event: PointerEvent) => {
    if (event.pointerType === 'touch' || blocked()) return;
    if (locked) {
      if (event.movementX || event.movementY)
        actions.emit('look', { dx: event.movementX, dy: event.movementY });
      return;
    }
    if (pointer !== event.pointerId) return;
    const dx = event.clientX - lastX,
      dy = event.clientY - lastY;
    lastX = event.clientX;
    lastY = event.clientY;
    if ((lastX - startX) ** 2 + (lastY - startY) ** 2 > 16) dragged = true;
    if ((dragged || button === 2) && (dx || dy)) actions.emit('look', { dx, dy });
  };
  const up = (event: PointerEvent) => {
    if (event.pointerId !== pointer) return;
    suppressClick = dragged || button === 2;
    clearDrag();
  };
  const cancel = (event: PointerEvent) => {
    if (event.pointerId !== pointer) return;
    suppressClick = true;
    clearDrag();
  };
  const click = (event: MouseEvent) => {
    if ('pointerType' in event && event.pointerType === 'touch') return;
    const suppressed = suppressClick;
    suppressClick = false;
    if (event.button !== 0 || suppressed || blocked()) return;
    if (locked) {
      if (flags.aimControls && aimCaptures()) return; // armed: the click was a shot (combat/fire.ts) — keep aiming
      const rect = canvas.getBoundingClientRect();
      release();
      actions.emit('interact', { clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 });
    } else if (fallback) {
      attempted = true;
      draw();
      actions.emit('interact', { clientX: event.clientX, clientY: event.clientY });
    } else request();
  };
  const wheel = (event: WheelEvent) => {
    if (blocked()) return;
    event.preventDefault();
    actions.emit('zoom', event.deltaY / (event.deltaMode === 1 ? 3 : event.deltaMode === 2 ? 1 : 100));
  };
  const menu = (event: MouseEvent) => {
    if (!blocked()) event.preventDefault();
  };
  const escape = (event: KeyboardEvent) => {
    if (event.code !== 'Escape') return;
    if (document.pointerLockElement === canvas || escapeHeld || performance.now() < unexpectedUnlockUntil) {
      escapeHeld = true;
      release();
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  };
  const keyup = (event: KeyboardEvent) => {
    if (event.code === 'Escape') {
      escapeHeld = false;
      unexpectedUnlockUntil = 0;
    }
  };
  const focus = (event: FocusEvent) => {
    if (event.target !== canvas && event.target !== document.body) release();
    draw();
  };
  const visibility = () => {
    if (document.hidden) release();
  };
  const blur = () => {
    escapeHeld = false;
    release();
  };
  canvas.addEventListener('pointerdown', down);
  canvas.addEventListener('pointermove', move);
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', cancel);
  canvas.addEventListener('lostpointercapture', cancel);
  canvas.addEventListener('click', click);
  canvas.addEventListener('wheel', wheel, { passive: false });
  canvas.addEventListener('contextmenu', menu);
  document.addEventListener('pointerlockchange', changed);
  document.addEventListener('pointerlockerror', denied);
  document.addEventListener('keydown', escape, true);
  document.addEventListener('keyup', keyup, true);
  document.addEventListener('focusin', focus);
  document.addEventListener('visibilitychange', visibility);
  target.addEventListener('blur', blur);
  target.addEventListener('pagehide', release);
  target.addEventListener('resize', draw);
  draw();
  return {
    release,
    get locked() {
      return locked;
    },
    get fallback() {
      return fallback;
    },
    get looking() {
      return locked || (pointer !== undefined && (button === 2 || dragged));
    },
    dispose(this: void): void {
      disposed = true;
      clearTimeout(hintTimer);
      release();
      offLock();
      offCursor();
      offMode();
      reticle.remove();
      hint.remove();
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('pointercancel', cancel);
      canvas.removeEventListener('lostpointercapture', cancel);
      canvas.removeEventListener('click', click);
      canvas.removeEventListener('wheel', wheel);
      canvas.removeEventListener('contextmenu', menu);
      // A pending browser grant can arrive after UI disposal. Keep only its settlement handlers.
      if (!awaitingNative) removeLockEvents();
      document.removeEventListener('keydown', escape, true);
      document.removeEventListener('keyup', keyup, true);
      document.removeEventListener('focusin', focus);
      document.removeEventListener('visibilitychange', visibility);
      target.removeEventListener('blur', blur);
      target.removeEventListener('pagehide', release);
      target.removeEventListener('resize', draw);
    },
  };
}
