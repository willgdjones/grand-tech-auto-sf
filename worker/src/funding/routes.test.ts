import { describe, expect, it, vi } from 'vitest';
import type { Env } from '../env';
import { handleFundingRequest } from './routes';

vi.mock('@gtasf/shared/flags', () => ({ flags: { fundingLoop: true } }));
function world(fetch: (request: Request) => Promise<Response>) {
  return { WORLD: { idFromName: () => 'sf', get: () => ({ fetch }) } } as unknown as Env;
}

describe('funding HTTP forwarding boundary', () => {
  it('returns a safe 503 for a lost World connection; reads retry once, mutations never', async () => {
    for (const [path, method, calls] of [['parties', 'GET', 2], ['status', 'GET', 2], ['start', 'POST', 1], ['profile', 'POST', 1]] as const) {
      const forward = vi.fn(async () => { throw new Error('Network connection lost.'); });
      const request = new Request(`https://gtasf.test/api/funding/${path}`, { method });
      const response = await handleFundingRequest(request, world(forward));
      expect(response?.status).toBe(503);
      expect(await response?.json()).toEqual({ error: 'Funding is temporarily unavailable' });
      expect(response?.headers.get('cache-control')).toBe('no-store');
      expect(forward).toHaveBeenCalledTimes(calls);
      if (method === 'POST') expect(forward).toHaveBeenCalledExactlyOnceWith(request);
    }
  });
  it('a boot-time GET that hits a restarting world (throw or 503) succeeds on the retry (QA: status 503 on boot)', async () => {
    const ok = Response.json({ state: 'idle' });
    const threw = vi.fn().mockRejectedValueOnce(new Error('Durable Object reset because its code was updated.')).mockResolvedValueOnce(ok);
    expect(await handleFundingRequest(new Request('https://gtasf.test/api/funding/status'), world(threw))).toBe(ok);
    const busy = vi.fn().mockResolvedValueOnce(Response.json({ error: 'Funding is temporarily unavailable' }, { status: 503 })).mockResolvedValueOnce(ok);
    expect(await handleFundingRequest(new Request('https://gtasf.test/api/funding/status'), world(busy))).toBe(ok);
    const down = Response.json({ error: 'Funding is temporarily unavailable' }, { status: 503 });
    const still = vi.fn().mockResolvedValueOnce(down).mockRejectedValueOnce(new Error('still down'));
    expect(await handleFundingRequest(new Request('https://gtasf.test/api/funding/status'), world(still))).toBe(down); // the world's own 503
    const post503 = vi.fn(async () => Response.json({ error: 'x' }, { status: 503 }));
    expect((await handleFundingRequest(new Request('https://gtasf.test/api/funding/mission-complete', { method: 'POST' }), world(post503)))?.status).toBe(503);
    expect(post503).toHaveBeenCalledOnce(); // money paths are never replayed
  });
  it('passes through the successful World response and validates routes before forwarding', async () => {
    const expected = new Response('canonical result', { status: 202, headers: { 'Set-Cookie': 'fixture=value; HttpOnly', 'X-World': 'kept' } });
    const forward = vi.fn(async () => expected);
    expect(await handleFundingRequest(new Request('https://gtasf.test/api/funding/status'), world(forward))).toBe(expected);
    // The founder-ladder first pitch posts its line index to /api/funding/pitch-text; it must be
    // allowlisted so it reaches WorldDO.handlePitchTap (which then gates on founderLadder && pitching).
    expect(await handleFundingRequest(new Request('https://gtasf.test/api/funding/pitch-text', { method: 'POST' }), world(forward))).toBe(expected);
    // Phase 5.1 meme-quest money paths: drive-start/drive-complete/share-claim must be allowlisted so they
    // reach their WorldDO handlers (which gate on memeQuests && driveQuest/shareQuest). Regression for the
    // bug where the handlers existed but the routes 404'd before forwarding, making the quests unreachable.
    // GTA-pivot mission money paths (LANE C): mission-start/mission-complete must be allowlisted too so they
    // reach handleMissionStart/Complete (which gate on flags.missions), same regression as the quests above.
    // GTA-pivot time trials (LANE C): tt-start/tt-submit were missing here, so every run 404'd at the edge and the
    // daily board never recorded a time in prod (#6.02-#6.06). The WorldDO handlers gate on flags.timeTrials.
    // GTA-pivot store robbery (LANE B): rob-start/rob-complete must be allowlisted so they reach handleRobStart/
    // handleRobComplete (which gate on combat && storeRobberies && wanted), else the payout routes would 404.
    for (const path of ['drive-start', 'drive-complete', 'share-claim', 'mission-start', 'mission-complete', 'rob-start', 'rob-complete', 'pilgrimage', 'pilgrimage-claim', 'missions', 'tt-start', 'tt-submit', 'mission-abandon', 'race-host', 'race-join', 'heist-join', 'rank', 'personal-car', 'personal-car-deliver', 'garage', 'garage-keep', 'garage-deliver']) {
      expect(await handleFundingRequest(new Request(`https://gtasf.test/api/funding/${path}`, { method: 'POST' }), world(forward))).toBe(expected);
    }
    const missing = await handleFundingRequest(new Request('https://gtasf.test/api/funding/missing'), world(forward));
    expect(missing?.status).toBe(404); expect(forward).toHaveBeenCalledTimes(24);
  });
});
