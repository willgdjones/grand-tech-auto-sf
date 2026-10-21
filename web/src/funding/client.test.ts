import { afterEach, expect, it, vi } from 'vitest';
// Default these tests to the v1 "work the room" path; the drive-through test flips driveThroughFunding on.
vi.mock('@gtasf/shared/flags', () => ({ flags: { fundingLoop: true, driveThroughFunding: false } }));
import { flags } from '@gtasf/shared/flags';
// flags is typed Readonly (Object.freeze); the mock object is mutable, so cast to toggle per test.
const testFlags = flags as { driveThroughFunding: boolean; chequeOnce?: boolean };
import { FUNDING_ROUNDS, quoteFunding, type FundingAward, type FundingLeaderboard, type FundingProfile, type FundingStatus } from '@gtasf/shared/funding';
import { createFundingClient, type FundingClient, type FundingTarget } from './client';

const original: FundingProfile = { deviceId: 'fixture-founder', startupName: 'Original startup', nickname: 'Original founder',
  totalCents: '0', todayCents: '0', round: FUNDING_ROUNDS[0]!, rank: null, todayRank: null, lastAwardAt: null, streak: 0 };
const saved = { ...original, startupName: 'Saved startup', nickname: 'Saved founder' };
const peer = { ...original, deviceId: 'another-founder', live: true };
const board = (you: FundingProfile): FundingLeaderboard => ({ you, week: [{ ...you, live: true }, peer], today: [{ ...you, live: true }], serverNow: Date.now() });
function deferred() {
  let resolve!: (value: Response) => void;
  return { promise: new Promise<Response>(done => { resolve = done; }), resolve: (value: unknown, status = 200) => resolve(Response.json(value, { status })) };
}
let client: FundingClient | undefined;
afterEach(() => { client?.destroy(); client = undefined; testFlags.driveThroughFunding = false; testFlags.chequeOnce = false; vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });

it('keeps a confirmed identity in late leaderboard results and self rows while accepting their money', async () => {
  const stale = deferred(), onProfile = vi.fn(), onLeaderboard = vi.fn();
  let nextBoard: Promise<Response> | undefined = stale.promise;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => url.endsWith('leaderboard')
    ? nextBoard! : Response.json(init?.method === 'POST' ? saved : original)));
  client = createFundingClient({ onProfile, onLeaderboard })!;
  await client.init(); const pending = client.leaderboard(); await client.saveIdentity('Saved startup', 'Saved founder');
  const earned = { ...original, totalCents: '60000000', todayCents: '60000000', round: FUNDING_ROUNDS[1]!, rank: 1, todayRank: 1, lastAwardAt: 100, streak: 1 };
  stale.resolve(board(earned)); const result = await pending;
  expect(client.profile).toMatchObject({ startupName: saved.startupName, nickname: saved.nickname, totalCents: earned.totalCents });
  expect(result.you).toEqual(client.profile); expect(result.week[0]).toMatchObject({ ...client.profile, live: true });
  expect(result.today[0]?.startupName).toBe(saved.startupName); expect(result.week[1]).toEqual(peer);
  expect(onLeaderboard).toHaveBeenLastCalledWith(result); expect(onProfile).toHaveBeenLastCalledWith(result.you);
  // A read started after the save remains authoritative (including an edit from another tab).
  nextBoard = Promise.resolve(Response.json(board({ ...earned, startupName: 'Edited in another tab', nickname: 'Other tab name' })));
  await client.leaderboard(); expect(client.profile?.startupName).toBe('Edited in another tab');
});

it('keeps the saved identity in late authoritative status and award callbacks without losing the award', async () => {
  const delayed = deferred(), onAward = vi.fn(), onStatus = vi.fn();
  const event = { id: 'public-event', title: 'Investor breakfast', start: '2026-10-05T16:00:00Z', end: '2026-10-05T18:00:00Z' };
  const quote = quoteFunding(event, Date.parse(event.start), 0, 1);
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/start')) return delayed.promise;
    if (url.includes('/event?')) return Response.json({ eventId: event.id, title: event.title, anchor: { x: 0, y: 0, z: 0 }, radiusM: 8, approx: false, quote, alreadyAwarded: false });
    return Response.json(init?.method === 'POST' ? saved : original);
  }));
  client = createFundingClient({ onAward, onStatus })!; await client.init(); await client.selectEvent(event.id);
  client.update({ x: 0, y: 0, z: 0 }, 'on-foot', true); expect(client.busy).toBe(true);
  await client.saveIdentity('Saved startup', 'Saved founder');
  const earned = { ...original, totalCents: quote.amountCents, todayCents: quote.amountCents, round: FUNDING_ROUNDS[2]!, lastAwardAt: 100, streak: 1 };
  const value: FundingStatus = { state: 'awarded', serverNow: 100, profile: earned, room: null,
    award: { ...quote, id: 'confirmed-award', eventId: event.id, eventTitle: event.title, awardedAt: 100, day: '2026-10-05', previousRound: original.round, profile: earned } };
  delayed.resolve(value); await vi.waitFor(() => expect(client!.busy).toBe(false));
  expect(client.profile).toMatchObject({ startupName: saved.startupName, totalCents: quote.amountCents });
  expect(onAward).toHaveBeenCalledTimes(1); expect(onAward.mock.calls[0]![0].profile).toMatchObject({ startupName: saved.startupName, totalCents: quote.amountCents });
  expect(onStatus.mock.calls[0]![0].profile.startupName).toBe(saved.startupName);
  expect(client.target?.alreadyAwarded).toBe(true);
});

it('applies a confirmed name without rewinding money earned during the save, and never applies a failed name', async () => {
  const saving = deferred(); let failSave = false;
  const earned = { ...original, totalCents: '60000000', todayCents: '60000000', round: FUNDING_ROUNDS[1]!, lastAwardAt: 100 };
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => init?.method === 'POST'
    ? failSave ? Response.json({ error: 'Try again' }, { status: 503 }) : saving.promise
    : Response.json(url.endsWith('leaderboard') ? board(earned) : original)));
  client = createFundingClient()!; await client.init(); const pending = client.saveIdentity('Saved startup', 'Saved founder');
  await client.leaderboard(); saving.resolve(saved); const result = await pending;
  expect(result).toMatchObject({ startupName: saved.startupName, totalCents: earned.totalCents }); expect(client.profile).toEqual(result);
  failSave = true; await expect(client.saveIdentity('Never saved', 'Never saved')).rejects.toThrow('Try again');
  expect(client.profile?.startupName).toBe(saved.startupName);
});

it('does not deliver a slow leaderboard after disposal, even if the transport ignores abort', async () => {
  const delayed = deferred(), onProfile = vi.fn(), onLeaderboard = vi.fn();
  vi.stubGlobal('fetch', vi.fn(async (url: string) => url.endsWith('leaderboard') ? delayed.promise : Response.json(original)));
  client = createFundingClient({ onProfile, onLeaderboard })!; await client.init(); const pending = client.leaderboard();
  client.destroy(); delayed.resolve(board(saved)); await pending;
  expect(onProfile).toHaveBeenCalledTimes(1); expect(onLeaderboard).not.toHaveBeenCalled();
});

const marker: FundingTarget = { eventId: 'refresh-event', title: 'Investor breakfast', anchor: { x: 0, y: 0, z: 0 }, radiusM: 8, approx: false,
  quote: quoteFunding({ id: 'refresh-event', title: 'Investor breakfast', start: '2026-10-05T16:00:00Z' }, Date.parse('2026-10-05T15:00:00Z'), 0, 1), alreadyAwarded: true };

it('keeps the event room through a pending/failed refresh, retries at a bounded rate and accepts a new server day', async () => {
  let now = 0, eventReads = 0, starts = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  const delayed = deferred(), recovered = deferred();
  const earned = { ...original, totalCents: '50000000', todayCents: '50000000', round: FUNDING_ROUNDS[1]! };
  const already: FundingStatus = { state: 'already-awarded', serverNow: 100, profile: earned, room: null, award: null };
  const working: FundingStatus = { ...already, state: 'working', room: { ...marker, startedAt: 100, finishesAt: 20100 } };
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.includes('/event?')) return ++eventReads === 1 ? Response.json({ ...marker, alreadyAwarded: false }) : eventReads === 2 ? delayed.promise : recovered.promise;
    if (url.endsWith('/start')) return Response.json(++starts === 1 ? already : working);
    if (url.endsWith('/cancel')) return Response.json({ ...already, state: 'cancelled' });
    return Response.json(url.endsWith('/leaderboard') ? board(earned) : earned);
  }));
  client = createFundingClient()!; await client.init(); await client.selectEvent(marker.eventId);
  const update = (x = 0) => client!.update({ x, y: 0, z: 0 }, 'on-foot', true, now);
  update(); await vi.waitFor(() => expect(client!.status?.state).toBe('already-awarded'));
  const previous = client.target, previousStatus = client.status;
  now = 60_001; update();
  expect(eventReads).toBe(2); expect(client.target).toBe(previous); expect(client.inside).toBe(true); expect(client.status).toBe(previousStatus);
  // A network read must not remove us, but physical departure still does.
  update(12); expect(client.inside).toBe(false); update(); expect(client.inside).toBe(true);
  delayed.resolve({ error: 'Temporary calendar failure' }, 503);
  await vi.waitFor(() => expect(client!.error).toBe('Temporary calendar failure'));
  expect(client.target).toBe(previous); expect(client.status).toBe(previousStatus); expect(client.inside).toBe(true);
  for (now of [63_001, 66_000, 70_000]) update();
  expect(eventReads).toBe(2);
  now = 70_001; update(); expect(eventReads).toBe(3); expect(client.target).toBe(previous);
  recovered.resolve({ ...marker, alreadyAwarded: false });
  await vi.waitFor(() => expect(client!.target?.alreadyAwarded).toBe(false));
  expect(client.error).toBe(''); expect(client.status).toBeNull(); expect(client.inside).toBe(true);
  update(); await vi.waitFor(() => expect(client!.status?.state).toBe('working'));
  expect(starts).toBe(2);
});

it('discards a late event refresh after choosing another destination', async () => {
  let now = 0, eventReads = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  const delayed = deferred(), other = { ...marker, eventId: 'other-event', title: 'Other meetup' };
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.includes('/event?')) return url.includes(other.eventId) ? Response.json(other) : ++eventReads === 1 ? Response.json(marker) : delayed.promise;
    return Response.json(url.endsWith('/leaderboard') ? board(original) : original);
  }));
  client = createFundingClient()!; await client.init(); await client.selectEvent(marker.eventId);
  now = 60_001; client.update({ x: 0, y: 0, z: 0 }, 'on-foot', true, now); expect(eventReads).toBe(2);
  await client.selectEvent(other.eventId); const selected = client.target;
  delayed.resolve({ ...marker, alreadyAwarded: false });
  // Await the complete fetch/text/refresh chain even when the transport ignores abort.
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(client.target).toBe(selected); expect(client.target?.eventId).toBe(other.eventId); expect(client.error).toBe('');
  await client.selectEvent(null); expect(client.target).toBeNull(); expect(client.inside).toBe(false);
});

it('discards a late refresh after disposal without emitting an error', async () => {
  let now = 0, eventReads = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  const delayed = deferred(), onError = vi.fn();
  vi.stubGlobal('fetch', vi.fn(async (url: string) => url.includes('/event?')
    ? ++eventReads === 1 ? Response.json(marker) : delayed.promise : Response.json(original)));
  client = createFundingClient({ onError })!; await client.init(); await client.selectEvent(marker.eventId);
  now = 60_001; client.update({ x: 0, y: 0, z: 0 }, 'on-foot', true, now);
  const previous = client.target; client.destroy(); delayed.resolve({ error: 'Late unavailable' }, 503);
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(client.target).toBe(previous); expect(client.error).toBe(''); expect(onError).not.toHaveBeenCalled();
});


it.each([503, 429, 408])('retries a temporary initial marker HTTP %s without reselection or a duplicate request', async httpStatus => {
  let now = 0, reads = 0, starts = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  const retry = deferred(), available = { ...marker, alreadyAwarded: false };
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.includes('/event?')) return ++reads === 1 ? Response.json({ error: 'Temporary calendar failure' }, { status: httpStatus }) : retry.promise;
    if (url.endsWith('/start')) starts++;
    return Response.json(url.endsWith('/leaderboard') ? board(original) : original);
  }));
  client = createFundingClient()!; await client.init(); await client.selectEvent(marker.eventId);
  expect(client.target).toBeNull(); expect(reads).toBe(1);
  const update = (connected = true) => client!.update({ x: 100, y: 0, z: 0 }, 'on-foot', connected, now);
  now = 2999; update(); expect(reads).toBe(1);
  now = 3001; update(false); expect(reads).toBe(1);
  update(); expect(reads).toBe(2);
  now = 9000; for (let frame = 0; frame < 10; frame++) update(); expect(reads).toBe(2);
  retry.resolve(available); await vi.waitFor(() => expect(client!.target?.eventId).toBe(marker.eventId));
  expect(client.error).toBe(''); expect(client.inside).toBe(false); expect(starts).toBe(0);
});

it.each(['network', 'timeout'])('recovers an initial marker %s failure at the same bounded retry time', async failure => {
  let now = 0, reads = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.includes('/event?')) {
      if (++reads === 1) throw failure === 'network' ? new TypeError('Failed to fetch') : new DOMException('Timed out', 'AbortError');
      return Response.json(marker);
    }
    return Response.json(url.endsWith('/leaderboard') ? board(original) : original);
  }));
  client = createFundingClient()!; await client.init(); await client.selectEvent(marker.eventId);
  now = 3001; client.update({ x: 100, y: 0, z: 0 }, 'on-foot', true, now);
  await vi.waitFor(() => expect(client!.target?.eventId).toBe(marker.eventId)); expect(reads).toBe(2);
});

it.each([400, 403, 404, 'invalid-marker', 'invalid-json'])('does not retry a permanent initial marker failure: %s', async failure => {
  let now = 0, reads = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.includes('/event?')) {
      reads++;
      return failure === 'invalid-marker' ? Response.json({ ...marker, eventId: 'wrong-event' })
        : failure === 'invalid-json' ? new Response('invalid JSON', { status: 200 })
        : Response.json({ error: 'Event unavailable' }, { status: failure as number });
    }
    return Response.json(url.endsWith('/leaderboard') ? board(original) : original);
  }));
  client = createFundingClient()!; await client.init(); await client.selectEvent(marker.eventId);
  for (now of [3001, 7000, 12000]) client.update({ x: 100, y: 0, z: 0 }, 'on-foot', true, now);
  expect(reads).toBe(1); expect(client.target).toBeNull();
});

it('retries repeated temporary marker failures without repeating the same error toast', async () => {
  let now = 0, reads = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  const onError = vi.fn();
  vi.stubGlobal('fetch', vi.fn(async (url: string) => url.includes('/event?')
    ? ++reads < 3 ? Response.json({ error: 'Temporary calendar failure' }, { status: 503 }) : Response.json(marker)
    : Response.json(url.endsWith('/leaderboard') ? board(original) : original)));
  client = createFundingClient({ onError })!; await client.init(); await client.selectEvent(marker.eventId);
  const update = () => client!.update({ x: 100, y: 0, z: 0 }, 'on-foot', true, now);
  now = 3001; update(); await new Promise(resolve => setTimeout(resolve, 0)); expect(reads).toBe(2);
  now = 6000; update(); expect(reads).toBe(2);
  now = 6002; update(); await vi.waitFor(() => expect(client!.target?.eventId).toBe(marker.eventId));
  expect(reads).toBe(3); expect(onError).toHaveBeenCalledTimes(1); expect(client.error).toBe('');
});

it('discards a late initial retry after the destination changes', async () => {
  let now = 0, reads = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  const retry = deferred(), other = { ...marker, eventId: 'other-event' }, onError = vi.fn();
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.includes('/event?')) return url.includes(other.eventId) ? Response.json(other)
      : ++reads === 1 ? Response.json({ error: 'Temporary calendar failure' }, { status: 503 }) : retry.promise;
    return Response.json(url.endsWith('/leaderboard') ? board(original) : original);
  }));
  client = createFundingClient({ onError })!; await client.init(); await client.selectEvent(marker.eventId);
  now = 3001; client.update({ x: 100, y: 0, z: 0 }, 'on-foot', true, now); expect(reads).toBe(2);
  await client.selectEvent(other.eventId); const selected = client.target;
  retry.resolve({ error: 'Late failed retry' }, 503); await new Promise(resolve => setTimeout(resolve, 0));
  expect(client.target).toBe(selected); expect(client.error).toBe(''); expect(onError).toHaveBeenCalledTimes(1);
  await client.selectEvent(null); now = 10000; client.update({ x: 100, y: 0, z: 0 }, 'on-foot', true, now);
  expect(client.target).toBeNull(); expect(reads).toBe(2);
  client.destroy(); now = 20000; client.update({ x: 100, y: 0, z: 0 }, 'on-foot', true, now); expect(reads).toBe(2);
});


it.each(['clear', 'dispose'])('cancels a pending initial marker retry on %s, even if transport ignores abort', async action => {
  let now = 0, reads = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  const retry = deferred(), onError = vi.fn();
  vi.stubGlobal('fetch', vi.fn(async (url: string) => url.includes('/event?')
    ? ++reads === 1 ? Response.json({ error: 'Temporary calendar failure' }, { status: 503 }) : retry.promise
    : Response.json(url.endsWith('/leaderboard') ? board(original) : original)));
  client = createFundingClient({ onError })!; await client.init(); await client.selectEvent(marker.eventId);
  now = 3001; client.update({ x: 100, y: 0, z: 0 }, 'on-foot', true, now); expect(reads).toBe(2);
  if (action === 'clear') await client.selectEvent(null); else client.destroy();
  retry.resolve({ error: 'Late retry failure' }, 503); await new Promise(resolve => setTimeout(resolve, 0));
  now = 10000; client.update({ x: 100, y: 0, z: 0 }, 'on-foot', true, now);
  expect(reads).toBe(2); expect(client.target).toBeNull(); expect(onError).toHaveBeenCalledTimes(1);
  expect(client.error).not.toBe('Late retry failure');
});

it.each([503, 429, 408, 'network', 'timeout'])('recovers one transient initial profile failure (%s) with a coalesced bounded retry', async failure => {
  vi.useFakeTimers(); let reads = 0;
  const onProfile = vi.fn();
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
    expect(init?.method).toBe('GET'); expect(init?.credentials).toBe('same-origin');
    if (++reads === 1) {
      if (failure === 'network') throw new TypeError('Failed to fetch');
      if (failure === 'timeout') throw new DOMException('Timed out', 'AbortError');
      return Response.json({ error: 'Temporary profile failure' }, { status: failure as number });
    }
    return Response.json(original);
  }));
  client = createFundingClient({ onProfile })!;
  const first = client.init(), second = client.init();
  const pending = Promise.allSettled([first, second]);
  await vi.advanceTimersByTimeAsync(0); expect(reads).toBe(1); expect(client.profile).toBeNull(); expect(onProfile).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(749); expect(reads).toBe(1);
  await vi.advanceTimersByTimeAsync(1);
  const results = await pending; expect(results.every(result => result.status === 'fulfilled')).toBe(true);
  expect(reads).toBe(2); expect(client.profile).toEqual(original); expect(onProfile).toHaveBeenCalledTimes(1);
  await client.init(); expect(reads).toBe(2); expect(vi.getTimerCount()).toBe(0);
});

it.each([400, 403, 404, 'invalid-json', 'invalid-profile'])('does not hide a permanent initial profile failure: %s', async failure => {
  vi.useFakeTimers(); let reads = 0;
  vi.stubGlobal('fetch', vi.fn(async () => {
    reads++;
    return failure === 'invalid-json' ? new Response('invalid JSON', { status: 200 })
      : failure === 'invalid-profile' ? Response.json({ ...original, totalCents: 'invalid' })
      : Response.json({ error: 'Profile unavailable' }, { status: failure as number });
  }));
  client = createFundingClient()!;
  await expect(client.init()).rejects.toThrow();
  await vi.advanceTimersByTimeAsync(5000); expect(reads).toBe(1); expect(client.profile).toBeNull(); expect(vi.getTimerCount()).toBe(0);
});

it('stops after one initial retry, then permits an explicit later init to recover', async () => {
  vi.useFakeTimers(); let reads = 0;
  vi.stubGlobal('fetch', vi.fn(async () => ++reads <= 2 ? Response.json({ error: 'Still unavailable' }, { status: 503 }) : Response.json(original)));
  client = createFundingClient()!;
  const pending = Promise.allSettled([client.init(), client.init()]);
  await vi.advanceTimersByTimeAsync(750);
  const results = await pending; expect(results.every(result => result.status === 'rejected')).toBe(true);
  await vi.advanceTimersByTimeAsync(5000); expect(reads).toBe(2); expect(client.profile).toBeNull();
  await client.init(); expect(reads).toBe(3); expect(client.profile).toEqual(original);
});

it('cancels the initial retry delay on disposal without another request or callback', async () => {
  vi.useFakeTimers(); let reads = 0;
  const onProfile = vi.fn();
  vi.stubGlobal('fetch', vi.fn(async () => { reads++; return Response.json({ error: 'Temporary profile failure' }, { status: 503 }); }));
  client = createFundingClient({ onProfile })!;
  const pending = Promise.allSettled([client.init(), client.init()]);
  await vi.advanceTimersByTimeAsync(0); client.destroy();
  expect((await pending).every(result => result.status === 'rejected')).toBe(true);
  await vi.advanceTimersByTimeAsync(5000); expect(reads).toBe(1); expect(onProfile).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
});

it('uses the retry read revision for identity reconciliation while protecting later saves', async () => {
  vi.useFakeTimers(); let reads = 0;
  const retry = deferred(), newer = { ...original, startupName: 'Fresh canonical startup', nickname: 'Fresh canonical founder' };
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === 'POST') return Response.json(saved);
    return ++reads === 1 ? Response.json({ error: 'Temporary profile failure' }, { status: 503 }) : retry.promise;
  }));
  client = createFundingClient()!;
  const pending = client.init();
  await vi.advanceTimersByTimeAsync(0); await client.saveIdentity(saved.startupName, saved.nickname);
  await vi.advanceTimersByTimeAsync(750); retry.resolve(newer); await pending;
  // This canonical read began after the save, so its fields remain authoritative.
  expect(client.profile?.startupName).toBe(newer.startupName);
  client.destroy();
  reads = 0; const later = deferred();
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => init?.method === 'POST' ? Response.json(saved)
    : ++reads === 1 ? Response.json({ error: 'Temporary profile failure' }, { status: 503 }) : later.promise));
  client = createFundingClient()!; const second = client.init();
  await vi.advanceTimersByTimeAsync(750); await client.saveIdentity(saved.startupName, saved.nickname);
  later.resolve(original); await second; expect(client.profile?.startupName).toBe(saved.startupName);
});

it('drive-through mode polls status for the pass-through award and never opens a room', async () => {
  testFlags.driveThroughFunding = true;
  let now = 0; const calls: string[] = []; const onAward = vi.fn();
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  const event = { id: 'evt-dt', title: 'Street Fair', start: '2026-10-05T16:00:00Z', end: '2026-10-05T18:00:00Z' };
  const quote = quoteFunding(event, Date.parse(event.start), 0, 1);
  const awarded = { ...original, totalCents: '60000000', todayCents: '60000000', round: FUNDING_ROUNDS[1]!, rank: 1, todayRank: 1, lastAwardAt: 1, streak: 1 };
  const award: FundingAward = { ...quote, id: 'award-dt-1', eventId: event.id, eventTitle: event.title, awardedAt: 1, day: '2026-10-05',
    previousRound: FUNDING_ROUNDS[0]!, profile: awarded, source: 'event' };
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    calls.push(url);
    if (url.endsWith('/status')) return Response.json({ state: 'awarded', serverNow: now, profile: awarded, room: null, award } satisfies FundingStatus);
    return Response.json(url.endsWith('/leaderboard') ? board(original) : original);
  }));
  client = createFundingClient({ onAward })!; await client.init();
  now = 2000; client.update({ x: 0, y: 0, z: 0 }, 'driver', true, now);
  await vi.waitFor(() => expect(onAward).toHaveBeenCalledTimes(1));
  expect(onAward.mock.calls[0]![0]).toMatchObject({ id: 'award-dt-1', source: 'event', amountCents: quote.amountCents });
  expect(calls.some(url => url.endsWith('/status'))).toBe(true);
  expect(calls.some(url => url.endsWith('/start'))).toBe(false);
});

it('keeps funding visible through a timed-out drive-through poll, backs off and accepts recovery once', async () => {
  testFlags.driveThroughFunding = true;
  let now = 0, statusReads = 0;
  const onError = vi.fn(), onAward = vi.fn();
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  const quote = quoteFunding({ id: 'recovered-event', title: 'Recovered event', start: '2026-10-05T16:00:00Z' }, Date.parse('2026-10-05T16:00:00Z'), 0, 1);
  const earned = { ...original, totalCents: quote.amountCents, todayCents: quote.amountCents };
  const award: FundingAward = { ...quote, id: 'recovered-award', eventId: 'recovered-event', eventTitle: 'Recovered event',
    awardedAt: 1, day: '2026-10-05', previousRound: original.round, profile: earned, source: 'event' };
  const fetcher = vi.fn(async (url: string) => {
    if (url.endsWith('/status')) {
      if (++statusReads === 1) throw new DOMException('signal is aborted without reason', 'AbortError');
      return Response.json({ state: 'awarded', serverNow: now, profile: earned, room: null, award } satisfies FundingStatus);
    }
    return Response.json(url.endsWith('/leaderboard') ? board(original) : original);
  });
  vi.stubGlobal('fetch', fetcher);
  client = createFundingClient({ onError, onAward })!; await client.init();
  const update = () => client!.update({ x: 0, y: 0, z: 0 }, 'driver', true, now);
  update(); await vi.waitFor(() => expect(client!.busy).toBe(false));
  expect(client.profile).toEqual(original);
  expect(onError).not.toHaveBeenCalled(); // one transport failure retries silently; the toast needs 3 in a row
  for (now of [1, 100, 1500, 2999]) update();
  expect(statusReads).toBe(1); expect(fetcher).toHaveBeenCalledTimes(2);
  now = 3000; update(); await vi.waitFor(() => expect(onAward).toHaveBeenCalledTimes(1));
  expect(client.profile?.totalCents).toBe(quote.amountCents); expect(client.error).toBe('');
  // Healthy and away from any drive-through target: the next status read is 6 s later (lane E: the flat 1.5 s poll was
  // ~40 req/min per player on the world DO). Recovery above still retried on the fast cadence.
  now = 4500; update(); await vi.waitFor(() => expect(client!.busy).toBe(false)); expect(statusReads).toBe(2);
  now = 9000; update(); await vi.waitFor(() => expect(client!.busy).toBe(false));
  expect(statusReads).toBe(3); expect(onAward).toHaveBeenCalledTimes(1);
});

it('summaries() POSTs the nicknames to /summary and returns the parsed FundingProfile[] (gtasf-2o0n)', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/summary')) {
      expect(init?.method).toBe('POST');
      expect(JSON.parse(String(init?.body))).toEqual({ nicknames: ['Foggy', 'Ada'] });
      return Response.json({ summaries: [peer] });
    }
    return Response.json(original); // init profile fetch
  }));
  client = createFundingClient()!; await client.init();
  expect(await client.summaries(['Foggy', 'Ada'])).toEqual([peer]);
  expect(await client.summaries([])).toEqual([]); // empty input short-circuits to []
});

it('collected() GETs /collected and returns ids; both methods return [] on a malformed body (gtasf-2o0n)', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/collected')) { expect(init?.method).toBe('GET'); return Response.json({ collectedEventIds: ['e1', 'e2'] }); }
    if (url.endsWith('/summary')) return Response.json({ notSummaries: true }); // malformed
    return Response.json(original);
  }));
  client = createFundingClient()!; await client.init();
  expect(await client.collected()).toEqual(['e1', 'e2']);
  expect(await client.summaries(['X'])).toEqual([]); // malformed summaries field -> []
});

it('a boot-time status 503 (world restarting) stays silent and the next poll recovers; a sustained outage still reports', async () => {
  testFlags.driveThroughFunding = true; // the status poll path (1.5 s) under test
  let now = 0, statusReads = 0, failing = 1;
  const onError = vi.fn();
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  const fetcher = vi.fn(async (url: string) => {
    if (url.endsWith('/status')) {
      statusReads++;
      if (failing-- > 0) return Response.json({ error: 'Funding is temporarily unavailable' }, { status: 503 });
      return Response.json({ state: 'idle', serverNow: now, profile: original, room: null, award: null } satisfies FundingStatus);
    }
    return Response.json(url.endsWith('/leaderboard') ? board(original) : original);
  });
  vi.stubGlobal('fetch', fetcher);
  client = createFundingClient({ onError })!; await client.init();
  const update = () => client!.update({ x: 0, y: 0, z: 0 }, 'driver', true, now);
  update(); await vi.waitFor(() => expect(client!.busy).toBe(false));
  expect(statusReads).toBe(1); expect(onError).not.toHaveBeenCalled();
  for (now of [1600, 3200, 4800]) { update(); await vi.waitFor(() => expect(client!.busy).toBe(false)); }
  expect(statusReads).toBeGreaterThan(1); expect(onError).not.toHaveBeenCalled(); expect(client.error).toBe('');
  failing = 99;
  for (now of [6400, 8000, 9600, 11200, 12800, 14400]) { update(); await vi.waitFor(() => expect(client!.busy).toBe(false)); }
  expect(onError).toHaveBeenCalledWith('Funding is temporarily unavailable');
});

it('chequeOnce (critic N3): a reload marks a cheque already shown on this device as a replay (state hooks run, no display); a new one shows', async () => {
  const store = new Map<string, string>();
  const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); } };
  const quote = quoteFunding({ id: 'evt-n3', title: 'Pitch to First Round Capital', start: '2026-10-05T16:00:00Z' }, Date.parse('2026-10-05T16:00:00Z'), 0, 1);
  const earned = { ...original, totalCents: quote.amountCents, todayCents: quote.amountCents };
  const awardFor = (id: string): FundingAward => ({ ...quote, id, eventId: 'evt-n3', eventTitle: 'Pitch to First Round Capital',
    awardedAt: 1, day: '2026-10-05', previousRound: original.round, profile: earned, source: 'celebrity' });
  // One page load: init, then drive-through status reads that answer `award` as 'awarded'. Returns [shown, replayed] onAward calls.
  async function load(award: FundingAward): Promise<[number, number]> {
    let now = 0; const onAward = vi.fn();
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    vi.stubGlobal('localStorage', storage);
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url.endsWith('/status')
      ? Response.json({ state: 'awarded', serverNow: now, profile: earned, room: null, award } satisfies FundingStatus)
      : Response.json(url.endsWith('/leaderboard') ? board(original) : original)));
    client = createFundingClient({ onAward })!; await client.init();
    now = 2000; client.update({ x: 0, y: 0, z: 0 }, 'driver', true, now);
    await vi.waitFor(() => expect((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.some(([u]) => String(u).endsWith('/status'))).toBe(true));
    await new Promise(resolve => setTimeout(resolve, 0));
    now = 9000; client.update({ x: 0, y: 0, z: 0 }, 'driver', true, now); await new Promise(resolve => setTimeout(resolve, 0)); // a later poll: still once
    const replays = onAward.mock.calls.filter(([, info]) => info?.replay === true).length;
    const fired: [number, number] = [onAward.mock.calls.length - replays, replays];
    client.destroy(); client = undefined; vi.restoreAllMocks(); return fired;
  }
  testFlags.driveThroughFunding = true; testFlags.chequeOnce = true;
  expect(await load(awardFor('award-n3-seed'))).toEqual([1, 0]); // banked and shown
  expect(await load(awardFor('award-n3-seed'))).toEqual([0, 1]); // reload: hooks run once as a replay, no display
  expect(await load(awardFor('award-n3-next'))).toEqual([1, 0]); // a new cheque still shows
  testFlags.chequeOnce = false; store.clear();
  expect(await load(awardFor('award-n3-seed'))).toEqual([1, 0]);
  expect(await load(awardFor('award-n3-seed'))).toEqual([1, 0]); // flag off: shows again as before
});
