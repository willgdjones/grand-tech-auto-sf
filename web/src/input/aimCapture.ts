/**
 * aimControls: a tiny bridge between the pointer-lock owner (pointer.ts) and combat (combat/fire.ts) without either
 * importing the other. Combat registers "clicks are shots right now"; pointer.ts publishes whether the mouse is aiming.
 */
let capture: (() => boolean) | undefined;
let state = { locked: false, fallback: false };

/** Combat: while `owns()` is true a captured click is a shot, so pointer.ts keeps the lock. Returns an unregister. */
export function setAimCapture(owns: () => boolean): () => void {
  capture = owns;
  return () => { if (capture === owns) capture = undefined; };
}
export function aimCaptures(): boolean { return capture?.() ?? false; }

/** pointer.ts: the current lock state. */
export function setPointerAimState(locked: boolean, fallback: boolean): void { state = { locked, fallback }; }
/** The mouse can aim now: the pointer is locked, or lock is unavailable and drag-look is the fallback. */
export function mouseAimReady(): boolean { return state.locked || state.fallback; }
export function pointerLocked(): boolean { return state.locked; }
