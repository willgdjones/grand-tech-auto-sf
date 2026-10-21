import { expect, it, vi } from 'vitest';
import { checkMovement, type MovementState } from './movement';
import { broadcastSnapshots, interestTier, type WorldPeer } from './snapshot';
import { decodeS2C } from '@gtasf/shared/protocol/s2c';
import { WorldTick } from './tick';
const pose = { x: 0, y: 0, z: 0, yaw: 0, flags: 0 };
it('rejects speed exploits and stale sequence without crediting rejected moves', () => {
  const state: MovementState = { pose, seq: 0, lastAt: 0, carryCm: 75, accepted: false };
  expect(checkMovement(state, { type: 'MOVE', seq: 65535, ...pose, x: 500 }, 1000)).toBe(true);
  const accepted = structuredClone(state);
  expect(checkMovement(state, { type: 'MOVE', seq: 0, ...pose, x: 10000 }, 1100)).toBe(false);
  expect(state).toEqual(accepted);
  expect(checkMovement(state, { type: 'MOVE', seq: 0, ...pose, x: 550 }, 1100)).toBe(true);
  expect(checkMovement(state, { type: 'MOVE', seq: 65535, ...pose }, 1200)).toBe(false);
});
it('sends city-sized snapshots to every member above the old cap', () => {
  let frames = 0;
  const peers = new Map<number, WorldPeer>();
  for (let id = 0; id < 301; id++) peers.set(id, { id, pose: { ...pose, x: id * 1000 }, send: bytes => {
    const result = decodeS2C(bytes); expect(result.ok).toBe(true);
    if (result.ok && result.msg.type === 'SNAPSHOT') expect(result.msg.entries).toHaveLength(300);
    frames++;
  } });
  broadcastSnapshots(peers, 10, 1780000000000); expect(frames).toBe(301);
  expect(interestTier(pose, { ...pose, x: 3900 })).toBe(0);
  expect(interestTier(pose, { ...pose, x: 4000 })).toBe(1);
  expect(interestTier(pose, { ...pose, x: 12100 })).toBe(2);
});
it('owns only one 10 Hz timer and stops when empty', () => {
  vi.useFakeTimers(); let count = 1; const step = vi.fn(); const timer = new WorldTick(() => count, step);
  try { timer.ensureTicking(); timer.ensureTicking(); vi.advanceTimersByTime(1000); expect(step).toHaveBeenCalledTimes(10); count = 0; timer.maybeStopTicking(); expect(timer.running).toBe(false); }
  finally { vi.useRealTimers(); }
});
it('preserves epsilon debt so repeated moves cannot harvest distance without elapsed server time', () => {
  const state: MovementState = { pose, seq: 0, lastAt: 0, carryCm: 75, accepted: false };
  expect(checkMovement(state, { type: 'MOVE', seq: 1, ...pose, x: 76 }, 0)).toBe(true);
  expect(state.carryCm).toBe(-1);
  for (let seq = 2; seq < 100; seq++) expect(checkMovement(state, { type: 'MOVE', seq, ...pose, x: 77 }, 0)).toBe(false);
  expect(state.pose.x).toBe(76);
});
it('retains 10/5/2 Hz proximity tiers and exact 40/120 m boundaries', () => {
  const counts = new Map<number, number>();
  const peers = new Map<number, WorldPeer>([0, 3999, 4000, 12000, 12001].map((x, id) => [id, {
    id, pose: { ...pose, x }, send(bytes: Uint8Array) {
      if (id !== 0) return;
      const decoded = decodeS2C(bytes);
      if (decoded.ok && decoded.msg.type === 'SNAPSHOT') for (const e of decoded.msg.entries) counts.set(e.id, (counts.get(e.id) ?? 0) + 1);
    },
  }]));
  for (let tick = 1; tick <= 10; tick++) broadcastSnapshots(peers, tick, tick * 100);
  expect([...counts.entries()].sort(([a], [b]) => a - b)).toEqual([[1, 10], [2, 5], [3, 5], [4, 2]]);
  expect(counts.has(0)).toBe(false);
});
