import { describe, expect, it, vi } from 'vitest';
import {
  PILGRIMAGE_BONUS_REF, PILGRIMAGE_MIN_TRAVEL_M, PILGRIMAGE_RADIUS_M, PILGRIMAGE_SITES, pilgrimageBonusCents,
  pilgrimageCredit, pilgrimageSiteCents,
} from '@gtasf/shared/founder/pilgrimage';
import { project } from '../funding/anchors';
import { markApproached, pilgrimageArrival, pilgrimageCollected, runPilgrimageClaim, type PilgrimageDeps } from './pilgrimage';

const site = PILGRIMAGE_SITES[0]!;
const arrived = { siteM: 5, approached: true };

function deps(refs: string[] = []) {
  const creditedRefs = vi.fn(async () => new Set(refs));
  const award = vi.fn<PilgrimageDeps['award']>(async () => ({ credited: true }));
  return { creditedRefs, award };
}

describe('pilgrimageArrival', () => {
  it('needs the authoritative pose inside the radius', () => {
    expect(pilgrimageArrival({ siteM: PILGRIMAGE_RADIUS_M, approached: true })).toBe('ok');
    expect(pilgrimageArrival({ siteM: PILGRIMAGE_RADIUS_M + 0.1, approached: true })).toBe('too-far');
  });
  it('rejects an arrival not approached by travel (deep link / robotaxi drop / respawn onto the site)', () => {
    expect(pilgrimageArrival({ siteM: 5, approached: false })).toBe('no-travel');
  });
});

describe('markApproached', () => {
  const p = project(site.lat, site.lon);
  it('marks a site only from a pose at least PILGRIMAGE_MIN_TRAVEL_M away', () => {
    const far = new Set<string>();
    markApproached(p.x + PILGRIMAGE_MIN_TRAVEL_M - 1, p.z, far);
    expect(far.has(site.id)).toBe(false); // dropped next to it: not approached
    markApproached(p.x + PILGRIMAGE_MIN_TRAVEL_M, p.z, far);
    expect(far.has(site.id)).toBe(true); // walked out far enough: coming back counts
  });
  it('a pose at the Ferry spawn has approached every site', () => {
    const far = new Set<string>(), ferry = project(37.7955, -122.3937);
    markApproached(ferry.x, ferry.z, far);
    expect(far.size).toBe(PILGRIMAGE_SITES.length);
  });
});

describe('runPilgrimageClaim', () => {
  it('pays a site once with a once-ever celebrity ref', async () => {
    const d = deps();
    const out = await runPilgrimageClaim(site, arrived, d);
    expect(out).toMatchObject({ status: 'completed', credited: true, amountCents: pilgrimageSiteCents().toString(), bonusCents: null, collected: 1 });
    const ref = pilgrimageCredit(site.id);
    expect(ref).toEqual({ source: 'celebrity', sourceRef: `pilgrimage:${site.id}` });
    expect(d.award).toHaveBeenCalledOnce();
    expect(d.award.mock.calls[0]![0]).toMatchObject({ ...ref, label: `SF pilgrimage: ${site.name} (1/${PILGRIMAGE_SITES.length})` });
  });
  it('does not pay a repeat, a far claim or a teleport arrival', async () => {
    const repeat = deps([pilgrimageCredit(site.id).sourceRef]);
    expect(await runPilgrimageClaim(site, arrived, repeat)).toEqual({ status: 'blocked', reason: 'already-claimed' });
    const far = deps(), tp = deps();
    expect(await runPilgrimageClaim(site, { siteM: 300, approached: true }, far)).toEqual({ status: 'too-far' });
    expect(await runPilgrimageClaim(site, { siteM: 5, approached: false }, tp)).toEqual({ status: 'no-travel' });
    for (const d of [repeat, far, tp]) expect(d.award).not.toHaveBeenCalled();
  });
  it('pays the completion bonus exactly once, on the last site', async () => {
    const others = PILGRIMAGE_SITES.filter(s => s.id !== site.id).map(s => pilgrimageCredit(s.id).sourceRef);
    const d = deps(others);
    const out = await runPilgrimageClaim(site, arrived, d);
    expect(out).toMatchObject({ status: 'completed', bonusCents: pilgrimageBonusCents().toString(), collected: PILGRIMAGE_SITES.length });
    expect(d.award).toHaveBeenCalledTimes(2);
    expect(d.award.mock.calls[1]![0]).toMatchObject({ source: 'celebrity', sourceRef: PILGRIMAGE_BONUS_REF });
    const again = deps([...others, PILGRIMAGE_BONUS_REF]);
    expect(await runPilgrimageClaim(site, arrived, again)).toMatchObject({ status: 'completed', bonusCents: null });
    expect(again.award).toHaveBeenCalledOnce();
  });
  it('lists collected sites from credited refs', () => {
    expect(pilgrimageCollected(new Set([pilgrimageCredit('lombard').sourceRef, 'meme:share:x']))).toEqual(['lombard']);
  });
});

describe('PILGRIMAGE_SITES', () => {
  it('has unique ids and no site is near the Ferry spawn', () => {
    expect(new Set(PILGRIMAGE_SITES.map(s => s.id)).size).toBe(PILGRIMAGE_SITES.length);
    const ferry = project(37.7955, -122.3937);
    for (const s of PILGRIMAGE_SITES) {
      const p = project(s.lat, s.lon);
      expect(Math.hypot(p.x - ferry.x, p.z - ferry.z), s.id).toBeGreaterThan(PILGRIMAGE_MIN_TRAVEL_M + PILGRIMAGE_RADIUS_M);
    }
  });
  it('bounds the lifetime payout to every site once plus one bonus', () => {
    const total = pilgrimageSiteCents() * BigInt(PILGRIMAGE_SITES.length) + pilgrimageBonusCents();
    expect(total).toBeLessThan(pilgrimageSiteCents() * 20n);
  });
});
