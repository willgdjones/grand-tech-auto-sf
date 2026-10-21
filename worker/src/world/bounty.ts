/**
 * WorldDO orchestration for the "Most Wanted founder" bounty (flag mostWantedBounty; money rules in founder/bounty.ts).
 * Every BOUNTY_REFRESH_MS it reloads the valuations of the combat-opted-in players online (bots and today's claimed
 * targets excluded), picks the Most Wanted, and tells each peer once per holder change (QUEST 'bounty'). After a server-
 * validated PvP kill's WASTED debit, a kill of the holder by another device claims the victim-funded bounty (that debit,
 * capped; founder/bounty.ts checks fresh valuations, friends and recent pair kills) and announces it to everyone. Every
 * PvP kill between devices is logged for the 7-day pair guard.
 */
import { encodeS2C } from '@gtasf/shared/protocol/s2c';
import { fundingDay } from '@gtasf/shared/funding';
import type { QuestEvent } from '@gtasf/shared/founder/questEvents';
import { bountyEligible, claimBounty, claimedTargetsToday, pickMostWanted, recordPvpKill, type BountyDeps, type BountyHolder } from '../founder/bounty';

export const BOUNTY_REFRESH_MS = 10_000;

export interface BountyPeer {
  readonly id: number;
  readonly combatActive?: boolean;
  readonly fundingDeviceId?: string;
  readonly session: { readonly name: string };
  send(bytes: Uint8Array): void;
}
export interface WorldBountyDeps extends BountyDeps {
  db(): D1Database;
  peers(): Iterable<BountyPeer>;
  /** A device's current valuation (cents) and whether it is an automated-test (is_bot) profile. */
  profile(device: string, now: number): Promise<{ cents: bigint; bot: boolean } | null>;
  /** The killer's HUD $ should refresh after the credit. */
  refreshProfile(device: string, now: number): Promise<void>;
  waitUntil(promise: Promise<unknown>): void;
}

export class WorldBounty {
  holder: BountyHolder | null = null;
  private readonly profiles = new Map<string, { cents: bigint; bot: boolean }>();
  private claimed = new Set<string>();
  private claimedDay = '';
  private readonly told = new Set<number>();
  /** Peers that have seen a marker (so a cleared bounty is only sent to clients that have one to remove). */
  private readonly wasAnnounced = new Set<number>();
  private refreshing = false;
  private refreshedAt = -Infinity;
  private claiming = false;
  constructor(private readonly deps: WorldBountyDeps) {}

  private send(peer: BountyPeer, event: QuestEvent): void { peer.send(encodeS2C({ type: 'QUEST', json: JSON.stringify(event) })); }
  private stateFor(peer: BountyPeer): QuestEvent {
    const h = this.holder;
    return h ? { kind: 'bounty', targetId: h.sid, name: h.name, amountCents: String(h.amountCents), you: peer.id === h.sid }
      : { kind: 'bounty', targetId: null, name: '', amountCents: '0', you: false };
  }

  /** Per tick: kick a valuation refresh when due, re-pick the holder, and tell peers who haven't heard the current state. */
  step(now: number): void {
    if (!this.refreshing && now - this.refreshedAt >= BOUNTY_REFRESH_MS) {
      this.refreshing = true; this.refreshedAt = now;
      this.deps.waitUntil(this.refresh(now).finally(() => { this.refreshing = false; }));
    }
    if (this.claiming) return; // a takedown is being paid: keep the holder until it settles
    const candidates = [];
    const online = new Set<number>();
    for (const p of this.deps.peers()) {
      online.add(p.id);
      const device = p.fundingDeviceId, prof = device ? this.profiles.get(device) : undefined;
      if (!device || !p.combatActive || !prof || prof.bot || this.claimed.has(device)) continue;
      candidates.push({ sid: p.id, device, name: p.session.name, cents: prof.cents });
    }
    const next = pickMostWanted(candidates, this.holder, now);
    if (next?.sid !== this.holder?.sid || next?.device !== this.holder?.device) this.told.clear();
    this.holder = next;
    for (const id of [...this.told]) if (!online.has(id)) this.told.delete(id);
    for (const p of this.deps.peers()) if (!this.told.has(p.id)) {
      this.told.add(p.id);
      if (this.holder || this.wasAnnounced.has(p.id)) this.send(p, this.stateFor(p));
      if (this.holder) this.wasAnnounced.add(p.id); else this.wasAnnounced.delete(p.id);
    }
  }
  private async refresh(now: number): Promise<void> {
    const day = fundingDay(now);
    if (day !== this.claimedDay) { this.claimed = new Set(); this.claimedDay = day; }
    try { for (const d of await claimedTargetsToday(this.deps.db(), now)) this.claimed.add(d); } catch { /* keep the last view */ }
    for (const p of this.deps.peers()) {
      if (!p.combatActive || !p.fundingDeviceId) continue;
      try { const prof = await this.deps.profile(p.fundingDeviceId, now); if (prof) this.profiles.set(p.fundingDeviceId, prof); } catch { /* skip */ }
    }
  }

  /** A server-validated PvP kill, AFTER the victim's WASTED debit (`victimDebitCents`) settled. Logs the kill for the
   *  pair guard, and pays the (victim-funded) bounty when the victim is the holder. Returns when both are done. */
  async onKill(victimId: number, victimDevice: string | undefined, killer: BountyPeer, victimDebitCents: bigint, now: number): Promise<void> {
    const holder = this.holder, killerDevice = killer.fundingDeviceId;
    const log = () => killerDevice && victimDevice && killerDevice !== victimDevice ? recordPvpKill(this.deps.db(), killerDevice, victimDevice, now).catch(() => undefined) : undefined;
    if (this.claiming || !bountyEligible(holder, victimId, victimDevice, killerDevice, now)) { await log(); return; }
    this.claiming = true;
    await claimBounty(this.deps.db(), holder, killerDevice!, victimDebitCents, this.deps, now).then(async result => {
      if (result.status === 'failed' || result.status === 'refused') return;
      this.claimed.add(holder.device); // paid or already claimed today: no longer Most Wanted
      this.holder = null; this.told.clear();
      if (result.status !== 'paid') return;
      for (const p of this.deps.peers()) this.send(p, { kind: 'bounty-claimed', killer: killer.session.name, target: holder.name,
        amountCents: String(result.amountCents), you: p.id === killer.id });
      await this.deps.refreshProfile(killerDevice!, now).catch(() => undefined);
    }).catch(() => undefined).finally(() => { this.claiming = false; });
    await log(); // after the claim, so this takedown never counts as its own 'recent pair' kill
  }
  /** A peer left: forget what we told it. */
  dropPeer(id: number): void { this.told.delete(id); this.wasAnnounced.delete(id); }
}
