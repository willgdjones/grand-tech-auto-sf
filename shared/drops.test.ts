import { expect, it } from 'vitest';
import {
  DROP_CAPACITY, DROP_INTERVAL_MS, DROP_LOCATIONS, DROP_LOOKAHEAD_MS, DROP_SPONSOR_MAX_AHEAD_MS, DROP_WINDOW_MS, PARODY_FUNDS,
  activeDropSlots, activeDrops, dropId, dropSlotAt, dropTagline, scheduleDrop, upcomingDrop, upcomingDropSlot,
  validateFundDropSponsorDraft,
} from './drops';

it('computes a deterministic, canonical schedule from the clock alone', () => {
  const slot = 5000;
  const opensAt = slot * DROP_INTERVAL_MS;
  const a = scheduleDrop(slot), b = scheduleDrop(slot);
  expect(a).toEqual(b); // pure function of the slot
  expect(a.id).toBe(dropId(slot));
  expect(a.opensAt).toBe(opensAt);
  expect(a.closesAt).toBe(opensAt + DROP_WINDOW_MS);
  expect(a.capacity).toBe(DROP_CAPACITY);
  expect(a.sponsored).toBe(false);
  expect(a.fundName).toBe(PARODY_FUNDS[slot % PARODY_FUNDS.length]);
  expect(a.location).toBe(DROP_LOCATIONS[slot % DROP_LOCATIONS.length]);
  expect(a.tagline).toBe(dropTagline(a.fundName));
  expect(a.tagline).toContain('come pitch!');
});

it('lets a paid sponsor rename a drop without changing its slot geometry or window', () => {
  const sponsor = { name: 'Acme Capital', url: 'https://acme.example' };
  const parody = scheduleDrop(7), sponsored = scheduleDrop(7, sponsor);
  expect(sponsored.fundName).toBe('Acme Capital');
  expect(sponsored.sponsored).toBe(true);
  expect(sponsored.sponsor).toEqual(sponsor);
  expect(sponsored.tagline).toBe('Acme Capital announces a new fund — come pitch!');
  // Geometry and timing are fixed by the slot, never by the sponsor.
  expect(sponsored.location).toBe(parody.location);
  expect(sponsored.opensAt).toBe(parody.opensAt);
  expect(sponsored.closesAt).toBe(parody.closesAt);
});

it('keeps exactly one slot open at all times, rotating on the interval boundary', () => {
  const slot = 1000, opensAt = slot * DROP_INTERVAL_MS;
  expect(activeDropSlots(opensAt)).toEqual([slot]);
  expect(activeDropSlots(opensAt + DROP_WINDOW_MS - 1)).toEqual([slot]);
  // The window is continuous: the next slot opens the instant this one closes, never a gap.
  expect(activeDropSlots(opensAt + DROP_WINDOW_MS)).toEqual([slot + 1]);
  expect(activeDropSlots(opensAt + DROP_INTERVAL_MS)).toEqual([slot + 1]);
  expect(dropSlotAt(opensAt + 1)).toBe(slot);
  // Always precisely one live drop across the whole interval.
  for (let t = opensAt; t < opensAt + DROP_INTERVAL_MS; t += DROP_INTERVAL_MS / 7) {
    expect(activeDropSlots(t)).toHaveLength(1);
    expect(activeDrops(t)).toHaveLength(1);
  }
});

it('teases the next slot only inside the lookahead window', () => {
  const slot = 1000, nextOpens = (slot + 1) * DROP_INTERVAL_MS;
  expect(upcomingDropSlot(nextOpens - DROP_LOOKAHEAD_MS)).toBe(slot + 1);
  expect(upcomingDropSlot(nextOpens - DROP_LOOKAHEAD_MS - 1)).toBeNull();
  expect(upcomingDropSlot(nextOpens - 1)).toBe(slot + 1);
  expect(upcomingDrop(nextOpens - 1)?.slot).toBe(slot + 1);
  // No teaser once it has opened (it is active, not upcoming).
  expect(upcomingDropSlot(nextOpens)).toBeNull();
  expect(upcomingDrop(nextOpens)).toBeNull();
});

it('applies a paid sponsor override through activeDrops', () => {
  const slot = dropSlotAt(2 * DROP_INTERVAL_MS + 5), now = slot * DROP_INTERVAL_MS + 10;
  const sponsor = { name: 'Acme Capital', url: 'https://acme.example' };
  const [drop] = activeDrops(now, [{ slot, sponsor }]);
  expect(drop!.sponsored).toBe(true);
  expect(drop!.fundName).toBe('Acme Capital');
  expect(activeDrops(now)[0]!.sponsored).toBe(false);
});

it('rejects invalid slots and clocks', () => {
  expect(() => scheduleDrop(-1)).toThrow(RangeError);
  expect(() => scheduleDrop(1.5)).toThrow(RangeError);
  expect(() => dropId(-1)).toThrow(RangeError);
  expect(() => dropSlotAt(-1)).toThrow(RangeError);
  expect(() => dropSlotAt(NaN)).toThrow(RangeError);
});

it('validates and normalises a sponsor-slot purchase draft', () => {
  const now = 100 * DROP_INTERVAL_MS + 10; // mid-slot-100
  const future = dropSlotAt(now) + 2;
  const draft = validateFundDropSponsorDraft({ slot: future, name: '  Acme   Capital  ', url: 'https://acme.example', logoUrl: 'https://acme.example/logo.png' }, now);
  expect(draft).toEqual({ slot: future, name: 'Acme Capital', url: 'https://acme.example', logoUrl: 'https://acme.example/logo.png' });
  // Optional links may be omitted.
  expect(validateFundDropSponsorDraft({ slot: future, name: 'Acme' }, now)).toEqual({ slot: future, name: 'Acme' });
});

it('refuses a non-future slot, an absurd far-future slot, a blank name and a non-https link', () => {
  const now = 100 * DROP_INTERVAL_MS + 10, current = dropSlotAt(now);
  expect(() => validateFundDropSponsorDraft({ slot: current, name: 'Acme' }, now)).toThrow(/future slot/);
  expect(() => validateFundDropSponsorDraft({ slot: current - 5, name: 'Acme' }, now)).toThrow(RangeError);
  const tooFar = dropSlotAt(now + DROP_SPONSOR_MAX_AHEAD_MS) + 2;
  expect(() => validateFundDropSponsorDraft({ slot: tooFar, name: 'Acme' }, now)).toThrow(/too far/);
  expect(() => validateFundDropSponsorDraft({ slot: current + 1, name: '   ' }, now)).toThrow(RangeError);
  expect(() => validateFundDropSponsorDraft({ slot: current + 1, name: 'Acme', url: 'http://acme.example' }, now)).toThrow(/https/);
  expect(() => validateFundDropSponsorDraft({ slot: current + 1, name: 'Acme', url: 'not a url' }, now)).toThrow(/valid URL/);
  expect(() => validateFundDropSponsorDraft({ slot: 1.5, name: 'Acme' }, now)).toThrow(RangeError);
});
