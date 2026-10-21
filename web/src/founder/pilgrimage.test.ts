import { describe, expect, it, vi } from 'vitest';
import { PILGRIMAGE_SITES } from '@gtasf/shared/founder/pilgrimage';
import { placePoint } from '../spawn/locations';
import { createPilgrimageTracker } from './pilgrimage';

const site = PILGRIMAGE_SITES[0]!;
const at = placePoint(site);
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

function setup(claim: () => Response) {
  const fetcher = vi.fn(async (url: string | URL | Request, _init?: RequestInit) => String(url).endsWith('/pilgrimage') ? json({ collected: [], total: PILGRIMAGE_SITES.length }) : claim());
  const notify = vi.fn(), onProfile = vi.fn();
  const tracker = createPilgrimageTracker({ notify, onProfile, sid: () => 7, fetcher: fetcher as typeof fetch });
  return { fetcher, notify, onProfile, tracker };
}
const flush = () => new Promise(resolve => setTimeout(resolve, 0));

describe('createPilgrimageTracker', () => {
  it('claims a landmark on arrival and marks it collected', async () => {
    const { fetcher, notify, tracker } = setup(() => json({ status: 'completed', outcome: { amountCents: '113025', bonusCents: null, collected: 1, total: 12 } }));
    await tracker.load();
    tracker.update({ x: at.x + 1000, z: at.z }); // far away: nothing
    expect(fetcher).toHaveBeenCalledTimes(1);
    tracker.update(at); await flush();
    const [url, init] = fetcher.mock.calls[1]!;
    expect(String(url)).toBe('/api/funding/pilgrimage-claim');
    expect(JSON.parse(String(init?.body))).toEqual({ siteId: site.id, sid: 7 });
    expect(notify).not.toHaveBeenCalled(); // the funding cheque card announces it (no stacked toast)
    expect(tracker.sites().find(s => s.site.id === site.id)?.collected).toBe(true);
    tracker.update(at); await flush();
    expect(fetcher).toHaveBeenCalledTimes(2); // collected: never re-claims
  });
  it('explains a teleport arrival once and waits for the player to leave', async () => {
    const { fetcher, notify, tracker } = setup(() => json({ status: 'no-travel' }, 409));
    await tracker.load();
    tracker.update(at); await flush();
    tracker.update(at); await flush();
    expect(fetcher).toHaveBeenCalledTimes(2); // one claim while standing there
    tracker.update({ x: at.x + 300, z: at.z }); tracker.update(at); await flush();
    expect(fetcher).toHaveBeenCalledTimes(3); // re-entry asks again
    expect(notify).toHaveBeenCalledTimes(1); // but the rule is explained once
  });
});
