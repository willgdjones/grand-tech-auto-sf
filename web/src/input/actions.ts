export interface MovementInput {
  x: number;
  z: number;
  run: boolean;
}
export interface ActionValues {
  move: Readonly<MovementInput>;
  look: Readonly<{ dx: number; dy: number }>;
  zoom: number;
  interact: Readonly<{ clientX: number; clientY: number }>;
  chat: undefined;
  emote1: undefined;
  emote2: undefined;
  emote3: undefined;
  emote4: undefined;
  emote5: undefined;
  map: undefined;
  buy: undefined;
  search: undefined;
  screenshot: undefined;
  feedback: undefined;
  close: undefined;
  pointerLock: undefined;
  releaseInput: undefined;
  steer: number;
  throttle: number;
  brake: number;
  handbrake: boolean;
  'enter-exit': undefined;
  hail: undefined;
  horn: undefined;
  ride: undefined;
  'mayhem-fire': undefined;
  'mayhem-cycle': undefined;
  share: undefined;
  recenter: undefined;
  outfit: undefined;
  recover: undefined;
}
export type ActionName = keyof ActionValues;
export const DESKTOP_ACTIONS = Object.freeze({
  Enter: 'chat',
  NumpadEnter: 'chat',
  KeyT: 'chat',
  Digit1: 'emote1',
  Digit2: 'emote2',
  Digit3: 'emote3',
  Digit4: 'emote4',
  Digit5: 'emote5',
  KeyM: 'map',
  KeyB: 'buy',
  Slash: 'search',
  KeyP: 'screenshot',
  KeyK: 'feedback', // founder playtest 2026-10-14: F is now the shoot key (combat); feedback moved to K
  Escape: 'close',
  KeyL: 'share',
  KeyC: 'recenter',
  KeyO: 'outfit',
  KeyR: 'recover',
} as const);
/** Registration is cold; dispatch borrows its payload and never creates a per-frame result object. */
export function createActions() {
  const handlers = new Map<ActionName, { handler?: (value: never) => void }[]>();
  let emitting = 0;
  return {
    on<K extends ActionName>(action: K, handler: (value: ActionValues[K]) => void): () => void {
      let entries = handlers.get(action);
      if (!entries) {
        entries = [];
        handlers.set(action, entries);
      }
      if (!emitting) {
        let kept = 0;
        for (let i = 0; i < entries.length; i++) if (entries[i]!.handler) entries[kept++] = entries[i]!;
        entries.length = kept;
      }
      // The typed on/emit pair enforces the action-payload relationship; erased storage stays private.
      const entry = { handler: handler as ((value: never) => void) | undefined };
      entries.push(entry);
      return () => {
        entry.handler = undefined;
      };
    },
    /** @hot */
    emit<K extends ActionName>(action: K, value: ActionValues[K]): void {
      const entries = handlers.get(action);
      if (!entries) return;
      const end = entries.length;
      emitting++;
      try {
        for (let i = 0; i < end; i++) entries[i]!.handler?.(value as never);
      } finally {
        emitting--;
      }
    },
    dispose(this: void): void {
      for (const entries of handlers.values()) for (const entry of entries) entry.handler = undefined;
      handlers.clear();
    },
  };
}
export type Actions = ReturnType<typeof createActions>;
/** Native HUD controls keep activation keys without taking ownership of WASD. */
export function consumesActivationKey(event: KeyboardEvent): boolean {
  return (
    (event.code === 'Enter' || event.code === 'NumpadEnter' || event.code === 'Space') &&
    event.target instanceof Element &&
    Boolean(event.target.closest('button, a[href], summary, [role="button"], [role="link"]'))
  );
}
/** Panel owners may additionally suppress the registry while a modal consumes keyboard input. */
export function consumesTextKeys(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    Boolean(
      target.closest(
        'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [data-consumes-keys]',
      ),
    )
  );
}
