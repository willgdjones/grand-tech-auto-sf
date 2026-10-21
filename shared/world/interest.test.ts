import { describe, expect, it } from 'vitest';
import { NEAREST_FULL, nearestPeers } from './interest';

interface P { id: number; x: number; z: number }
const opts = (x: number, z: number, selfId?: number) => ({
  x, z, posX: (p: P) => p.x, posZ: (p: P) => p.z,
  ...(selfId !== undefined ? { skip: (p: P) => p.id === selfId } : {}),
});
const line: P[] = [
  { id: 1, x: 1, z: 0 }, { id: 2, x: 2, z: 0 }, { id: 3, x: 3, z: 0 },
  { id: 4, x: 4, z: 0 }, { id: 5, x: 5, z: 0 },
];

describe('bounded nearest-K interest selection', () => {
  it('returns the k nearest peers, nearest first', () => {
    expect(nearestPeers(line, 3, opts(0, 0)).map(p => p.id)).toEqual([1, 2, 3]);
    expect(nearestPeers(line, 1, opts(0, 0)).map(p => p.id)).toEqual([1]);
  });

  it('skips items the predicate rejects (e.g. self)', () => {
    const withSelf = [{ id: 0, x: 0, z: 0 }, ...line];
    expect(nearestPeers(withSelf, 2, opts(0, 0, 0)).map(p => p.id)).toEqual([1, 2]);
  });

  it('returns all peers sorted when k exceeds the count', () => {
    expect(nearestPeers(line, 99, opts(0, 0)).map(p => p.id)).toEqual([1, 2, 3, 4, 5]);
  });

  it('handles k<=0 as empty', () => {
    expect(nearestPeers(line, 0, opts(0, 0))).toEqual([]);
    expect(nearestPeers(line, -5, opts(0, 0))).toEqual([]);
  });

  it('measures planar distance across both axes and signs', () => {
    const mixed: P[] = [
      { id: 1, x: 0, z: -2 },  // d2 = 4
      { id: 2, x: -1, z: 0 },  // d2 = 1
      { id: 3, x: 0, z: 3 },   // d2 = 9
    ];
    expect(nearestPeers(mixed, 2, opts(0, 0)).map(p => p.id)).toEqual([2, 1]);
  });

  it('reads position through accessors (works on nested shapes, no per-item allocation)', () => {
    interface Peer { id: number; pose: { x: number; z: number } }
    const peers: Peer[] = [
      { id: 1, pose: { x: 5, z: 0 } }, { id: 2, pose: { x: 1, z: 0 } }, { id: 3, pose: { x: 3, z: 0 } },
    ];
    const near = nearestPeers(peers, 2, { x: 0, z: 0, posX: p => p.pose.x, posZ: p => p.pose.z });
    expect(near.map(p => p.id)).toEqual([2, 3]);
  });

  it('caps a dense crowd to exactly k nearest, in order, regardless of input order', () => {
    const crowd: P[] = Array.from({ length: 300 }, (_, i) => ({ id: i + 1, x: i + 1, z: 0 }));
    const near = nearestPeers(crowd, NEAREST_FULL, opts(0, 0));
    expect(near).toHaveLength(NEAREST_FULL);
    expect(near.map(p => p.id)).toEqual(Array.from({ length: NEAREST_FULL }, (_, i) => i + 1));
    const reversed = nearestPeers([...crowd].reverse(), NEAREST_FULL, opts(0, 0));
    expect(new Set(reversed.map(p => p.id))).toEqual(new Set(near.map(p => p.id)));
    expect(NEAREST_FULL).toBe(60);
  });
});
