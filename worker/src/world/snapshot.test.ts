import { describe, expect, it } from 'vitest';
import { broadcastSnapshots, snapshotEntries, type WorldPeer } from './snapshot';
import { decodeS2C } from '@gtasf/shared/protocol/s2c';
import type { Pose } from '@gtasf/shared/protocol/types';

// Poses are centimetres; interestTier divides by 100, so 100 cm = 1 m apart keeps a row
// of peers inside tier 0 (<40 m) — every tick, no cadence drops — isolating the cap.
const pose = (x: number): Pose => ({ x, y: 0, z: 0, yaw: 0, flags: 0 });
function peer(id: number, x: number, sent: Pose[][] = []): WorldPeer & { frames: Pose[][] } {
  const frames: Pose[][] = sent;
  return {
    id, pose: pose(x), frames,
    send(bytes: Uint8Array) {
      const msg = decodeS2C(bytes);
      if (msg.ok && msg.msg.type === 'SNAPSHOT') frames.push(msg.msg.entries.map(e => ({ x: e.x, y: e.y, z: e.z, yaw: e.yaw, flags: e.flags })));
    },
  };
}

describe('bounded snapshot interest', () => {
  it('without a cap, a viewer sees every other in-tier peer', () => {
    const self = peer(0, 0);
    const peers = [self, peer(1, 100), peer(2, 200), peer(3, 300), peer(4, 400)];
    const entries = snapshotEntries(self, peers, 1);
    expect(entries.map(e => e.x).sort((a, b) => a - b)).toEqual([100, 200, 300, 400]);
  });

  it('with a cap, a viewer considers only the nearest cap peers', () => {
    const self = peer(0, 0);
    const peers = [self, peer(1, 100), peer(2, 200), peer(3, 300), peer(4, 400)];
    const entries = snapshotEntries(self, peers, 1, 2);
    expect(entries.map(e => e.x).sort((a, b) => a - b)).toEqual([100, 200]);
  });

  it('broadcastSnapshots bounds every viewer to the cap', () => {
    const peers = new Map<number, WorldPeer>();
    const views = [peer(0, 0), peer(1, 100), peer(2, 200), peer(3, 300), peer(4, 400), peer(5, 500)];
    for (const p of views) peers.set(p.id, p);
    broadcastSnapshots(peers, 1, Date.now(), 2);
    for (const view of views) {
      const frame = (view as WorldPeer & { frames: Pose[][] }).frames.at(-1) ?? [];
      // Each viewer sees at most the cap (2) nearest others, never itself.
      expect(frame.length).toBeLessThanOrEqual(2);
      expect(frame.every(e => e.x !== view.pose.x)).toBe(true);
    }
  });
});
