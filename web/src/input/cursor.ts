import { renderChannel } from '../render/events';

const changes = renderChannel<void>();
let owners = 0;
export const needsFreeCursor = (): boolean => owners > 0;
export const onCursorModeChange = (listener: () => void): (() => void) => changes.on(listener);
/** Nested UI owners release only their own lease. Closing UI never captures the mouse. */
export function holdFreeCursor(): () => void {
  owners++;
  changes.emit(undefined);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    owners--;
    changes.emit(undefined);
  };
}
