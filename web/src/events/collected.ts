import type { VenueGroup } from './venues';

/** A venue still offers a cheque while any of its focus events remains unpaid. */
export function venueCollected(group: Pick<VenueGroup, 'focus'>, ids: ReadonlySet<string>): boolean {
  return group.focus.length > 0 && group.focus.every(view => ids.has(view.event.id));
}

/** Merge authoritative once-ever history with awards received while that history is loading. */
export function createCollectedEvents(options: {
  load(): Promise<readonly string[]>;
  onChange(ids: ReadonlySet<string>): void;
}) {
  const ids = new Set<string>();
  let disposed = false, pending: Promise<void> | undefined, awardRevision = 0;
  function merge(values: readonly string[]) {
    if (disposed) return;
    const size = ids.size;
    for (const id of values) if (typeof id === 'string' && id.length) ids.add(id);
    if (ids.size !== size) options.onChange(ids);
  }
  function refresh(): Promise<void> {
    if (disposed) return Promise.resolve();
    if (pending) return pending;
    const startedRevision = awardRevision;
    pending = Promise.resolve().then(() => disposed ? [] : options.load()).then(merge)
      .catch(() => { /* Keep known awards; the next connection can retry history. */ })
      .finally(() => {
        pending = undefined;
        // An older snapshot can omit the other events in a combined venue cheque.
        if (!disposed && awardRevision !== startedRevision) void refresh();
      });
    return pending;
  }
  return {
    refresh,
    add(id: string) {
      const size = ids.size;
      merge([id]);
      if (ids.size !== size) awardRevision++;
    },
    destroy() { disposed = true; },
  };
}
