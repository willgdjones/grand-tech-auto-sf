import { expect, it } from 'vitest';
import { createRemotes } from './remotes';
import { createSyncedClock } from './clock';
import { FakeClock } from '@gtasf/shared/clock';
it('interpolates distant city coordinates and takes the short yaw arc', () => {
  const remotes = createRemotes(), base = { id: 70000, x: 900000, y: 5000, z: -900000, yaw: 250, flags: 0 };
  remotes.push(base, 1000); remotes.push({ ...base, x: 900100, yaw: 6 }, 1100);
  const p = remotes.sample(base.id, 1170, base)!; expect(p.x).toBe(900050); expect(p.yaw).toBe(0);
  remotes.remove(base.id); expect(remotes.sample(base.id, 1200, base)).toBeUndefined();
});
it('uses a real offset sample and keeps server time monotonic', () => {
  const time = new FakeClock(1700000000000), clock = createSyncedClock({ clock: time });
  clock.welcome(1700000000200); time.advance(20); clock.pong(1700000000210, 0, 20);
  expect(clock.isSynced()).toBe(true); const before = clock.serverNow(); time.advance(100); clock.observe(); expect(clock.serverNow()).toBeGreaterThanOrEqual(before); clock.dispose();
});
