import type { ViewportSize } from './sizing';

export type ViewportChanged = Readonly<ViewportSize & { cssChanged: boolean }>;
export type RenderScaleChanged = Readonly<{ scale: number }>;
/** Events are infrequent allocation/viewport transitions, never per-frame messages. */
export function renderChannel<T>() {
  const listeners = new Set<(event: T) => void>();
  return {
    on(listener: (event: T) => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    emit(event: T): void {
      for (const listener of listeners) listener(event);
    },
    clear(): void {
      listeners.clear();
    },
  };
}
