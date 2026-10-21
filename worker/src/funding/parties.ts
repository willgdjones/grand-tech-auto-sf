import { FUNDING_ROUNDS, fundingRound, type FundingProfile } from '@gtasf/shared/funding';
import { FUNDING_PARTY_DURATION_MS, type FundingParties, type FundingParty } from '@gtasf/shared/funding-perks';
import type { FundingPeer } from './world';

/** Ephemeral cosmetic parties, owned by a live device and its server-observed position. */
export class FundingPartiesState {
  private readonly parties = new Map<string, FundingParty>();
  set(profile: FundingProfile, hosting: boolean, peers: readonly FundingPeer[], now: number): void {
    if (!hosting) { this.parties.delete(profile.deviceId); return; }
    if (fundingRound(profile.totalCents).stars < 3) throw new RangeError(`Reach ${FUNDING_ROUNDS.find(round => round.stars >= 3)!.label} to host a party`);
    const peer = peers.find(value => value.deviceId === profile.deviceId && value.onFoot);
    if (!peer) throw new RangeError('Join the city on foot to host your party');
    this.parties.set(profile.deviceId, { hostId: profile.deviceId, startupName: profile.startupName,
      anchor: { x: peer.pose.x / 100, y: peer.pose.y / 100, z: peer.pose.z / 100 }, endsAt: now + FUNDING_PARTY_DURATION_MS });
  }
  snapshot(deviceId: string, peers: readonly FundingPeer[], now: number): FundingParties {
    const live = new Set(peers.flatMap(peer => peer.deviceId ? [peer.deviceId] : []));
    for (const [id, party] of this.parties) if (party.endsAt <= now || !live.has(id)) this.parties.delete(id);
    const viewer = peers.find(peer => peer.deviceId === deviceId);
    const distance = (party: FundingParty) => viewer ? Math.hypot(party.anchor.x - viewer.pose.x / 100, party.anchor.z - viewer.pose.z / 100) : Infinity;
    return { parties: [...this.parties.values()].sort((a, b) => distance(a) - distance(b) || a.hostId.localeCompare(b.hostId)).slice(0, 32),
      yours: this.parties.get(deviceId) ?? null, serverNow: now };
  }
}
