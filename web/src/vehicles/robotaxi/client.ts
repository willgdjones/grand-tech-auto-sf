import { flags } from '@gtasf/shared/flags';
import type { C2SMessage, PlayerMode, Point, RobotaxiState, S2CMessage } from '@gtasf/shared/protocol/types';

export interface TaxiDestination { x: number; y: number; z: number; title: string; event?: { id: string }; friend?: string }
type TaxiCommand = Extract<C2SMessage, { type: 'ROBOTAXI_HAIL' | 'ROBOTAXI_CANCEL' | 'ROBOTAXI_QUOTE' | 'ROBOTAXI_READY' }>;
interface TaxiClientOptions {
  send(message: TaxiCommand): boolean;
  notify(text: string, milliseconds?: number): void;
  getMode(): PlayerMode;
  onQuick?(message: Extract<S2CMessage, { type: 'ROBOTAXI_STATE' }>): void;
  onEnd?(arrived: boolean): void;
  /** Takes world metres and returns the road-snapped destination in world metres. */
  resolveDestination(destination: TaxiDestination): { x: number; y: number; z: number };
}
const isActive = (state: string) => state === 'requested' || state === 'pickup' || state === 'riding' || state === 'quick';

export interface TaxiQuote { label: string; affordable: boolean; fareCents: string }
export const taxiFareLabel = (cents: string, free: number) => cents === '0' ? `FREE (${free} left)` : `$${(Number(cents) / 100).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
/** Trip UI follows server messages; this controller never owns a seat or moves a taxi. */
export function createRobotaxiClient(options: TaxiClientOptions) {
  let state: RobotaxiState | 'idle' | 'reconnecting' = 'idle';
  let connected = false, restoreAllowed = true, cancelling = false;
  // reconnectGrace (gtasf-j7wvv): the server holds a ride for 20 s across a socket drop. Defer the ride's end until the
  // reconnect shows whether it was restored, so the Seed swoop / quick ride / job ride isn't failed by a 1-4 s blip.
  let endPending = false, endTimer: ReturnType<typeof setTimeout> | undefined;
  const endHeldRide = () => { if (!endPending) return; endPending = false; clearTimeout(endTimer); options.onEnd?.(false); };
  let sequence = 0, requestId = 0, vehicleId = 0, etaSeconds = 0;
  let target: { point: Point; title: string; event?: { id: string }; friend?: string } | undefined;

  const quotes = new Map<string, { at: number; promise: Promise<TaxiQuote>; value?: TaxiQuote }>();
  const pendingQuotes = new Map<number, (value: TaxiQuote) => void>();
  const unresolvedQuotes = new Set<(value: TaxiQuote) => void>();
  const unavailable: TaxiQuote = { label: 'Unavailable', affordable: false, fareCents: '' };
  let quoteGeneration = 0;
  let quoteQueue = Promise.resolve();
  const key = (d: TaxiDestination) => `${Math.round(d.x)},${Math.round(d.z)}:${d.event?.id ?? ''}:${d.friend ?? ''}`;
  const metadata = (d: TaxiDestination, maxFareCents = '') => ({ title: Array.from(d.title).slice(0, 60).join(''), eventId: d.event?.id ?? '', friend: d.friend ?? '', maxFareCents });
  const wire = (d: TaxiDestination): Point => ({ x: Math.round(d.x * 100), y: Math.round(d.y * 100), z: Math.round(d.z * 100) });
  function releasePendingQuotes(): void {
    // A dead transport must not spend five seconds on every queued calendar row.
    // Invalidate unsent work and resolve its callers so they can offer a fresh retry.
    quoteGeneration++; quoteQueue = Promise.resolve();
    for (const finish of pendingQuotes.values()) finish(unavailable);
    for (const finish of unresolvedQuotes) finish(unavailable);
  }
  // reconnectGrace (gtasf-j7wvv; critic: a drop at the QUOTE stage showed FARE UNAVAILABLE and lost the phone ride, with no
  // reconnect notice): a quote cut off by a dropped or not-yet-back socket waits up to 10 s for the reconnect and asks once
  // more. Transport failures resolve with the shared `unavailable`; a real server answer is always a fresh object.
  let transportDrops = 0;
  const reconnectWaiters = new Set<() => void>();
  const wakeReconnectWaiters = () => { for (const wake of [...reconnectWaiters]) wake(); };
  const waitConnected = (ms: number) => new Promise<boolean>(resolve => {
    if (connected) { resolve(true); return; }
    const wake = () => { clearTimeout(timer); reconnectWaiters.delete(wake); resolve(true); };
    const timer = setTimeout(() => { reconnectWaiters.delete(wake); resolve(false); }, ms);
    reconnectWaiters.add(wake);
  });
  function quote(destination: TaxiDestination): Promise<TaxiQuote> {
    if (!flags.reconnectGrace) return quoteOnce(destination);
    const drops = transportDrops;
    return quoteOnce(destination).then(async value =>
      value === unavailable && (transportDrops !== drops || !connected) && await waitConnected(10_000) ? quoteOnce(destination) : value);
  }
  function quoteOnce(destination: TaxiDestination): Promise<TaxiQuote> {
    const cached = quotes.get(key(destination));
    if (cached && Date.now() - cached.at < 30_000) return cached.promise;
    const generation = quoteGeneration;
    const entry = { at: Date.now(), promise: Promise.resolve(unavailable), value: undefined as TaxiQuote | undefined };
    entry.promise = new Promise(resolve => {
      let settled = false;
      const finish = (value: TaxiQuote) => {
        if (settled) return;
        settled = true;
        unresolvedQuotes.delete(finish); entry.value = value;
        if (!value.fareCents && quotes.get(key(destination)) === entry) quotes.delete(key(destination));
        resolve(value);
      };
      unresolvedQuotes.add(finish);
      quoteQueue = quoteQueue.then(async () => {
        if (generation !== quoteGeneration || !connected || !flags.quickRobotaxi) { finish(unavailable); return; }
        const id = sequence = (sequence + 1) >>> 0;
        const value = await new Promise<TaxiQuote>(done => {
          const timer = setTimeout(releasePendingQuotes, 5000);
          pendingQuotes.set(id, result => { clearTimeout(timer); pendingQuotes.delete(id); done(result); });
          try {
            if (!options.send({ type: 'ROBOTAXI_QUOTE', requestId: id, destination: wire(destination), quick: metadata(destination) })) releasePendingQuotes();
          } catch { releasePendingQuotes(); }
        });
        finish(value);
        await new Promise(done => setTimeout(done, 100));
      });
    });
    if (quotes.size > 200) quotes.clear();
    quotes.set(key(destination), entry); return entry.promise;
  }
  function cancel(): boolean {
    if (!flags.robotaxi || !connected || !isActive(state) || cancelling) return false;
    if (!options.send({ type: 'ROBOTAXI_CANCEL', requestId })) {
      options.notify('Connecting to the city…'); return false;
    }
    cancelling = true; options.notify('Cancelling robotaxi…', 8000); return true;
  }
  function hail(destination: TaxiDestination): boolean {
    if (!flags.robotaxi) { options.notify('Robotaxis are currently unavailable.'); return false; }
    if (!connected) { options.notify('Connecting to the city…'); return false; }
    if (isActive(state)) { options.notify('Cancel your current robotaxi before choosing a new trip.'); return false; }
    if (options.getMode() !== 'on-foot') { options.notify('Exit your vehicle before hailing.'); return false; }
    // Clear route keeps the old coordinates but clears its title in the main loop.
    if (!destination.title.trim()) { options.notify('Choose a destination on the map before hailing.'); return false; }
    const road = flags.quickRobotaxi ? destination : options.resolveDestination(destination);
    const point = { x: Math.round(road.x * 100), y: Math.round(road.y * 100), z: Math.round(road.z * 100) };
    const nextId = (sequence + 1) >>> 0;
    if (!options.send({ type: 'ROBOTAXI_HAIL', requestId: nextId, destination: point, ...(flags.quickRobotaxi ? { quick: metadata(destination, quotes.get(key(destination))?.value?.fareCents ?? '') } : {}) })) {
      options.notify('Connecting to the city…'); return false;
    }
    sequence = requestId = nextId; target = { point, title: destination.title };
    state = 'requested'; vehicleId = 0; etaSeconds = 0; restoreAllowed = false; cancelling = false;
    options.notify(`Hailing a robotaxi to ${target.title}…`, 8000); return true;
  }
  return {
    get state() { return state; },
    get vehicleId() { return vehicleId; },
    get etaSeconds() { return etaSeconds; },
    get active() { return isActive(state); },
    get destinationTitle() { return target?.title ?? 'Saved destination'; },
    get buttonLabel() {
      return cancelling ? 'Cancelling robotaxi…' : state === 'riding' || state === 'quick' ? 'End robotaxi ride · H'
        : isActive(state) ? 'Cancel robotaxi · H' : flags.quickRobotaxi ? 'Where to? · H' : 'Hail robotaxi · H';
    },
    hail, quote,
    ready() { return connected && state === 'quick' && options.send({ type: 'ROBOTAXI_READY', requestId }); },
    cancel,
    toggle(destination: TaxiDestination): boolean { return isActive(state) ? cancel() : hail(destination); },
    setConnected(value: boolean): void {
      connected = value;
      if (value) wakeReconnectWaiters();
      if (!value) {
        transportDrops++;
        if (flags.reconnectGrace && unresolvedQuotes.size && !isActive(state)) options.notify('Reconnecting to the city…', 10000); // a fare was loading
        releasePendingQuotes();
        quotes.clear();
        if (flags.reconnectGrace && isActive(state)) endPending = true; else options.onEnd?.(false);
        if (isActive(state)) options.notify('Reconnecting to the city…', 12000);
        state = 'reconnecting'; vehicleId = 0; etaSeconds = 0; cancelling = false;
        restoreAllowed = true;
      }
    },
    message(message: S2CMessage): void {
      if (message.type === 'ROBOTAXI_FRIEND_NOTICE' && flags.quickRobotaxi) { options.notify(`${message.name} is on the way`, 6000); return; }
      if (message.type === 'WELCOME') {
        if (endPending) { // wait briefly for ROBOTAXI_STATE to restore the held ride; none -> it really ended
          clearTimeout(endTimer);
          endTimer = setTimeout(() => { if (!endPending) return; endHeldRide(); options.notify('Reconnected. Press H to hail a robotaxi.'); }, 6000);
        } else if (state === 'reconnecting' && target) options.notify('Reconnected. Press H to hail a robotaxi.');
        connected = true; state = 'idle'; vehicleId = 0; etaSeconds = 0; cancelling = false;
        restoreAllowed = true; wakeReconnectWaiters(); return;
      }
      if (!flags.robotaxi || !connected || message.type !== 'ROBOTAXI_STATE') return;
      const pendingQuote = pendingQuotes.get(message.requestId);
      if (pendingQuote) {
        pendingQuote({ label: message.quick && message.state !== 'unavailable' ? taxiFareLabel(message.quick.fareCents, message.quick.freeRidesLeft) : 'Unavailable',
          affordable: message.state === 'quoted', fareCents: message.quick?.fareCents ?? '' }); return;
      }
      if (message.state === 'quoted') return;
      if (restoreAllowed && isActive(message.state)) {
        requestId = message.requestId; sequence = Math.max(sequence, requestId);
        if (!target || target.point.x !== message.destination.x || target.point.y !== message.destination.y || target.point.z !== message.destination.z) {
          target = { point: { ...message.destination }, title: 'Saved destination' };
        }
        restoreAllowed = false;
        if (endPending) { endPending = false; clearTimeout(endTimer); options.notify('Reconnected. Your robotaxi ride continues.', 4000); } // reconnectGrace: same ride
      }
      if (restoreAllowed || message.requestId !== requestId || (!isActive(state) && state !== 'idle')) return;
      const previous = state;
      state = message.state; vehicleId = isActive(state) ? message.vehicleId : 0;
      etaSeconds = message.etaSeconds;
      if (!isActive(state)) { cancelling = false; quotes.clear(); options.onEnd?.(state === 'arrived'); }
      if (state === 'quick' && previous !== 'quick') options.onQuick?.(message);
      if (cancelling) return;
      const title = target?.title ?? 'Saved destination';
      const labels: Record<RobotaxiState, string> = {
        quick: 'On the way…', unaffordable: `Not enough funding: ${message.quick ? taxiFareLabel(message.quick.fareCents, 0) + ' fare. ' : ''}Walk or drive`, quoted: '',
        requested: 'Finding a robotaxi…',
        pickup: etaSeconds ? `Robotaxi arriving · ${etaSeconds}s` : 'Your robotaxi is waiting at the curb. Walk toward it to board.',
        riding: `Robotaxi → ${title} · ${etaSeconds}s`,
        arrived: `ARRIVED · ${title}`, // critic R2: MISSION PASSED is earned by missions, not taxi rides
        cancelled: 'Robotaxi cancelled',
        unavailable: 'No route from here. Walk to the curb and hail again.',
      };
      options.notify(labels[state], 6000);
    },
  };
}
