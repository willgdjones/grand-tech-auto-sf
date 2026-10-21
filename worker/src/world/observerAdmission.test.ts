import { describe, expect, it } from 'vitest';
import { OBSERVER_POSE_MIN_INTERVAL_MS, OBSERVER_PER_CLIENT_CAP, observerZoneCap, observerPoseUpdateAllowed, observerRejectStatus, observerTargetAllowed } from './observerAdmission';
import { observerProtocols, readObserverIdentity } from '@gtasf/shared/world/observers';

describe('observerRejectStatus', () => {
  it('rejects a cross-site observer with 403 regardless of capacity', () => {
    expect(observerRejectStatus(false, 0, 50)).toBe(403);
    expect(observerRejectStatus(false, 999, 50)).toBe(403);
  });

  it('rejects a same-origin observer with 503 once the zone is at capacity', () => {
    expect(observerRejectStatus(true, 50, 50)).toBe(503);
    expect(observerRejectStatus(true, 51, 50)).toBe(503);
  });

  it('admits a same-origin observer below capacity', () => {
    expect(observerRejectStatus(true, 0, 50)).toBeNull();
    expect(observerRejectStatus(true, 49, 50)).toBeNull();
  });

  it('rejects once a single client holds the per-client cap, even far below the zone total', () => {
    expect(observerRejectStatus(true, 10, 1000, OBSERVER_PER_CLIENT_CAP, OBSERVER_PER_CLIENT_CAP)).toBe(503);
    expect(observerRejectStatus(true, 10, 1000, OBSERVER_PER_CLIENT_CAP - 1, OBSERVER_PER_CLIENT_CAP)).toBeNull();
  });

  it('admits many distinct clients up to the generous zone total (no border seam at scale)', () => {
    const zoneCap = observerZoneCap(250); // 1000
    expect(zoneCap).toBeGreaterThan(250);
    expect(observerRejectStatus(true, 300, zoneCap, 1, OBSERVER_PER_CLIENT_CAP)).toBeNull(); // > player cap, still fine
    expect(observerRejectStatus(true, zoneCap, zoneCap, 1, OBSERVER_PER_CLIENT_CAP)).toBe(503); // total backstop
  });
});

describe('observerPoseUpdateAllowed', () => {
  it('allows the first update (no prior timestamp)', () => {
    expect(observerPoseUpdateAllowed(1000, undefined)).toBe(true);
  });

  it('throttles updates faster than one tick, allows them at/after the interval', () => {
    const last = 1000;
    expect(observerPoseUpdateAllowed(last + OBSERVER_POSE_MIN_INTERVAL_MS - 1, last)).toBe(false);
    expect(observerPoseUpdateAllowed(last + OBSERVER_POSE_MIN_INTERVAL_MS, last)).toBe(true);
    expect(observerPoseUpdateAllowed(last + OBSERVER_POSE_MIN_INTERVAL_MS + 50, last)).toBe(true);
  });
});

it('carries a validated session in the header and authorizes only neighbours of the real pose', () => {
  const grid = { minX: 0, minZ: 0, cols: 3, rows: 3, cell: 1000 };
  const identity = { id: 42, home: { cx: 0, cy: 1 }, token: 'a'.repeat(64) };
  expect(readObserverIdentity(observerProtocols(identity).join(', '), grid)).toEqual(identity);
  expect(readObserverIdentity('gtasf.v2', grid)).toBeUndefined();
  expect(readObserverIdentity(observerProtocols({ ...identity, token: 'invalid' }).join(','), grid)).toBeUndefined();
  const pose = { x: 99000, y: 0, z: 150000, yaw: 0, flags: 0 };
  expect(observerTargetAllowed(pose, identity.home, { cx: 1, cy: 1 }, grid)).toBe(true);
  expect(observerTargetAllowed(pose, identity.home, { cx: 2, cy: 1 }, grid)).toBe(false);
  expect(observerTargetAllowed(pose, identity.home, identity.home, grid)).toBe(false);
  expect(observerTargetAllowed({ ...pose, x: 102000 }, identity.home, { cx: 1, cy: 1 }, grid)).toBe(true);
});
