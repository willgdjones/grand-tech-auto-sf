import { afterEach, expect, it, vi } from 'vitest';
import type { FundDropState, LiveFundDrop } from '@gtasf/shared/drops';
import { compassOf, createDropsClient, type DropsClient } from './client';

function liveDrop(overrides: Partial<LiveFundDrop> = {}): LiveFundDrop {
  return {
    id: 'drop-sf-tech-week-2026-1000', slot: 1000, fundName: 'Dry Powder Partners',
    tagline: 'Dry Powder Partners announces a new fund — come pitch!', sponsored: false,
    location: { lat: 37.7955, lon: -122.3937, label: 'Ferry Building Plaza' },
    opensAt: 1000, closesAt: Date.now() + 300_000, capacity: 50, chequeCents: '25000000',
    anchor: { x: 100, y: 0, z: 0 }, radiusM: 12, claimed: 13, remaining: 37, yourClaim: null, ...overrides,
  };
}
function stateWith(drop: LiveFundDrop, recentClaim: FundDropState['recentClaim'] = null): FundDropState {
  return { serverNow: Date.now(), active: [drop], upcoming: null, recentClaim };
}
const flush = () => new Promise<void>(resolve => setTimeout(resolve, 0));
let client: DropsClient | undefined;
afterEach(() => { client?.destroy(); client = undefined; vi.unstubAllGlobals(); });

it('maps a 3D offset to a compass heading (+x east, -z north)', () => {
  expect(compassOf(100, 0).compass).toBe('E');
  expect(compassOf(0, -100).compass).toBe('N');
  expect(compassOf(0, 100).compass).toBe('S');
  expect(compassOf(-100, 0).compass).toBe('W');
  expect(compassOf(100, -100).compass).toBe('NE');
});

it('polls the drop state, reports the nearest open drop, and fires a claim once', async () => {
  const claim = { dropId: 'drop-sf-tech-week-2026-1000', slot: 1000, fundName: 'Dry Powder Partners', amountCents: '25000000', position: 37, claimedAt: Date.now() };
  let state = stateWith(liveDrop());
  const fetchMock = vi.fn(async () => Response.json(state));
  vi.stubGlobal('fetch', fetchMock);
  const onClaim = vi.fn();
  let seen!: () => void; const firstState = new Promise<void>(resolve => { seen = resolve; });
  client = createDropsClient({ onClaim, onState: () => seen() })!;
  client.init();
  await firstState; await flush();

  expect(client.active).toHaveLength(1);
  client.update({ x: 0, y: 0, z: 0 }, 'driver', true, 1000);
  const near = client.nearest!;
  expect(near.drop.fundName).toBe('Dry Powder Partners');
  expect(near.compass).toBe('E');
  expect(Math.round(near.distance)).toBe(100);

  // The claim arrives in a later poll; it fires exactly once even though it stays in recentClaim.
  state = stateWith(liveDrop({ yourClaim: claim }), claim);
  client.update({ x: 95, y: 0, z: 0 }, 'driver', true, 1_000_000); await flush();
  client.update({ x: 95, y: 0, z: 0 }, 'driver', true, 2_000_000); await flush();
  expect(onClaim).toHaveBeenCalledTimes(1);
  expect(onClaim).toHaveBeenCalledWith(expect.objectContaining({ position: 37, amountCents: '25000000' }));
});
