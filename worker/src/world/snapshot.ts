import { encodeS2C } from '@gtasf/shared/protocol/s2c';
import { SNAPSHOT_MAX_ENTRIES } from '@gtasf/shared/protocol/constants';
import { nearestPeers } from '@gtasf/shared/world/interest';
import type { Pose, SnapshotEntry } from '@gtasf/shared/protocol/types';
export interface WorldPeer { id: number; pose: Pose; send(bytes: Uint8Array): void }
/** BDTS distance interest cadence retained; city membership is a Map, never a capped slot array.
 * An optional per-viewer `cap` additionally limits how many peers a player considers at all
 * (the nearest `cap`), bounding each SNAPSHOT in a dense zone (docs/engineering/zoned-world.md
 * §6). Omitting `cap` keeps the whole-city behaviour unchanged. */
export function interestTier(a: Pose, b: Pose): 0 | 1 | 2 {
  const distance = Math.hypot(a.x - b.x, a.z - b.z) / 100;
  return distance < 40 ? 0 : distance <= 120 ? 1 : 2;
}
export function snapshotEntries(self: WorldPeer, peers: Iterable<WorldPeer>, tick: number, cap?: number): SnapshotEntry[] {
  // With a cap, consider only the nearest `cap` peers (self excluded); otherwise every peer.
  const considered: Iterable<WorldPeer> = cap && cap > 0
    ? nearestPeers(peers, cap, { x: self.pose.x, z: self.pose.z, posX: p => p.pose.x, posZ: p => p.pose.z, skip: p => p.id === self.id })
    : peers;
  const entries: SnapshotEntry[] = [];
  for (const peer of considered) {
    if (peer.id === self.id || tick % [1, 2, 5][interestTier(self.pose, peer.pose)]! !== 0) continue;
    entries.push({ id: peer.id, ...peer.pose });
  }
  return entries;
}
export function broadcastSnapshots(peers: Map<number, WorldPeer>, tick: number, serverT: number, cap?: number): void {
  for (const self of peers.values()) {
    const entries = snapshotEntries(self, peers.values(), tick, cap);
    // Frame-size chunking is independent of population; no admission ceiling or lobby.
    for (let i = 0; i < Math.max(1, entries.length); i += SNAPSHOT_MAX_ENTRIES)
      self.send(encodeS2C({ type: 'SNAPSHOT', tick, serverT, entries: entries.slice(i, i + SNAPSHOT_MAX_ENTRIES) }));
  }
}
