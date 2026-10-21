import { describe, expect, it, vi } from 'vitest';

vi.mock('@gtasf/shared/flags', async (orig) => {
  const actual = await orig<typeof import('@gtasf/shared/flags')>();
  return { ...actual, flags: { ...actual.flags, economyV3: true } };
});

import { decodeS2C } from '@gtasf/shared/protocol/s2c';
import { parseQuestEvent, type QuestEvent } from '@gtasf/shared/founder/questEvents';
import { recordFundingCredit } from '../funding/credits';
import { BOUNTY_CAP_CENTS, BOUNTY_MIN_HELD_MS } from '../founder/bounty';

const DEBIT = 1_800_000n; // the victim's WASTED debit for the takedown ($18k, under the cap)
import { NOW, START_CENTS, balance, freshDb, seedPlayer } from '../founder/bountyTestDb';
import { BOUNTY_REFRESH_MS, WorldBounty, type BountyPeer } from './bounty';

function world(values: Record<string, { cents: bigint; bot?: boolean }>) {
  const { sqlite, db } = freshDb();
  for (const d of Object.keys(values)) seedPlayer(sqlite, d, START_CENTS);
  const inbox = new Map<number, QuestEvent[]>();
  const peers: (BountyPeer & { combatActive: boolean })[] = [];
  const add = (id: number, device: string, combatActive = true) => {
    inbox.set(id, []);
    const p = { id, combatActive, fundingDeviceId: device, session: { name: device.toUpperCase() },
      send: (bytes: Uint8Array) => { const d = decodeS2C(bytes); if (d.ok && d.msg.type === 'QUEST') inbox.get(id)!.push(parseQuestEvent(d.msg.json)!); } };
    peers.push(p); return p;
  };
  const pending: Promise<unknown>[] = [];
  const refreshProfile = vi.fn(async () => {});
  const bounty = new WorldBounty({
    db: () => db, peers: () => peers,
    profile: async device => { const v = values[device]; return v ? { cents: v.cents, bot: !!v.bot } : null; },
    valuation: async device => values[device]?.cents ?? 0n,
    award: input => recordFundingCredit(db, { ...input, source: 'celebrity' }),
    refreshProfile, waitUntil: p => { pending.push(p); },
  });
  const settle = async () => { while (pending.length) await pending.shift(); };
  const tick = async (now: number) => { bounty.step(now); await settle(); bounty.step(now); };
  return { sqlite, bounty, add, inbox, tick, settle, refreshProfile };
}

describe('WorldBounty (WorldDO orchestration)', () => {
  it('marks the richest opted-in, non-bot founder and tells each peer once', async () => {
    const w = world({ rich: { cents: 900_000_000n }, botty: { cents: 9_000_000_000n, bot: true }, shy: { cents: 9_000_000_000n }, k1: { cents: 1n } });
    w.add(1, 'rich'); w.add(2, 'botty'); w.add(3, 'shy', false); w.add(4, 'k1');
    await w.tick(NOW);
    expect(w.bounty.holder).toMatchObject({ device: 'rich', sid: 1, amountCents: BOUNTY_CAP_CENTS });
    expect(w.inbox.get(1)).toEqual([{ kind: 'bounty', targetId: 1, name: 'RICH', amountCents: String(BOUNTY_CAP_CENTS), you: true }]);
    expect(w.inbox.get(4)).toEqual([{ kind: 'bounty', targetId: 1, name: 'RICH', amountCents: String(BOUNTY_CAP_CENTS), you: false }]);
    await w.tick(NOW + BOUNTY_REFRESH_MS);
    expect(w.inbox.get(4)).toHaveLength(1); // no re-send while the holder is unchanged
  });
  it('a takedown before the marker has been up 3 min pays nothing; after, the killer collects the victim’s debit once and all are told', async () => {
    const w = world({ rich: { cents: 900_000_000n }, k1: { cents: 1n }, k2: { cents: 1n } });
    w.add(1, 'rich'); const k1 = w.add(4, 'k1'); const k2 = w.add(5, 'k2');
    await w.tick(NOW);
    await w.bounty.onKill(1, 'rich', k1, DEBIT, NOW + BOUNTY_MIN_HELD_MS - 1);
    expect(balance(w.sqlite, 'k1')).toBe(START_CENTS);
    w.sqlite.prepare('DELETE FROM pvp_kill_log').run(); // (that early kill was logged; clear it so the pair guard doesn't apply)
    const first = w.bounty.onKill(1, 'rich', k1, DEBIT, NOW + BOUNTY_MIN_HELD_MS);
    const second = w.bounty.onKill(1, 'rich', k2, DEBIT, NOW + BOUNTY_MIN_HELD_MS); // same moment: ignored while the claim settles
    await Promise.all([first, second]); await w.settle();
    expect(balance(w.sqlite, 'k1')).toBe(START_CENTS + Number(DEBIT));
    expect(balance(w.sqlite, 'k2')).toBe(START_CENTS);
    expect(w.inbox.get(5)!.at(-1)).toEqual({ kind: 'bounty-claimed', killer: 'K1', target: 'RICH', amountCents: String(DEBIT), you: false });
    expect((w.sqlite.prepare('SELECT COUNT(*) n FROM pvp_kill_log').get() as { n: number }).n).toBe(2); // both kills logged for the pair guard
    expect(w.inbox.get(4)!.at(-1)).toMatchObject({ kind: 'bounty-claimed', you: true });
    expect(w.refreshProfile).toHaveBeenCalledWith('k1', NOW + BOUNTY_MIN_HELD_MS);
    // The claimed target is no longer Most Wanted today: the marker clears for everyone who had it.
    await w.tick(NOW + BOUNTY_MIN_HELD_MS + BOUNTY_REFRESH_MS);
    expect(w.bounty.holder).toBeNull();
    expect(w.inbox.get(5)!.at(-1)).toEqual({ kind: 'bounty', targetId: null, name: '', amountCents: '0', you: false });
  });
  it('killing someone who is not the Most Wanted pays nothing', async () => {
    const w = world({ rich: { cents: 900_000_000n }, mid: { cents: 50_000_000n }, k1: { cents: 1n } });
    w.add(1, 'rich'); w.add(2, 'mid'); const k1 = w.add(4, 'k1');
    await w.tick(NOW);
    await w.bounty.onKill(2, 'mid', k1, DEBIT, NOW + BOUNTY_MIN_HELD_MS);
    expect(balance(w.sqlite, 'k1')).toBe(START_CENTS);
  });
});
