import type { RadarEvent } from '../radar/radar';

/** Keep a linked event pending until both its calendar entry and routing are ready. */
export function createLinkedDestination(eventId: string | undefined, select: (event: RadarEvent) => boolean) {
  let pending = eventId, ready = false, selecting = false;
  let events: readonly RadarEvent[] = [];
  function cancel() { pending = undefined; events = []; }
  function attempt() {
    if (!pending || !ready || selecting) return;
    const event = events.find(value => value.id === pending);
    if (!event) return;
    selecting = true;
    try { if (select(event)) cancel(); }
    finally { selecting = false; }
  }
  return {
    setEvents(next: readonly RadarEvent[]) { if (!pending) return; events = next; attempt(); },
    start() { ready = true; attempt(); },
    /** An accepted manual destination or teardown permanently supersedes this link. */
    cancel,
  };
}
