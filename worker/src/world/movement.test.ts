import { describe, it, expect } from 'vitest';
import type { MoveMessage } from '@gtasf/shared/protocol/types';
import { checkMovement, ON_FOOT_CAP_MPS, type MovementState } from './movement';
import { rideSpeedCapMps } from '@gtasf/shared/content/rides';
import { FUNDING_ROUNDS } from '@gtasf/shared/funding';

// v2.1 gtasf-v21-walk-sprint smoke: with sprint raised to 8 m/s the server on-foot cap must carry a
// legit sprint (even downhill, which adds vertical travel to the guard's 3D distance) without ever
// issuing a CORRECTION, while still rejecting teleport-speed moves. Coordinates are centimetres.
function state(): MovementState {
  return { pose: { x: 0, y: 0, z: 0, yaw: 0, flags: 0 }, seq: 0, lastAt: 1000, carryCm: 0, accepted: false };
}
function move(partial: Partial<MoveMessage>): MoveMessage {
  return { type: 'MOVE', x: 0, y: 0, z: 0, yaw: 0, flags: 0, seq: 1, ...partial };
}

describe('on-foot movement cap (v2.1 walk/sprint)', () => {
  // 8 m/s sprint over 200 ms = 160 cm horizontal.
  it('accepts a flat sprint at the raised cap', () => {
    const s = state();
    expect(checkMovement(s, move({ x: 160, seq: 1 }), 1200, ON_FOOT_CAP_MPS)).toBe(true);
  });

  it('accepts a downhill sprint (horizontal + vertical 3D distance)', () => {
    const s = state();
    // 160 cm forward and 100 cm down in 200 ms -> 3D distance ~189 cm, under the 11 m/s (220 cm) budget.
    expect(checkMovement(s, move({ x: 160, y: -100, seq: 1 }), 1200, ON_FOOT_CAP_MPS)).toBe(true);
  });

  it('rejects a teleport-speed move even at the raised cap', () => {
    const s = state();
    // 20 m/s over 200 ms = 400 cm, well past the 220 cm budget -> CORRECTION.
    expect(checkMovement(s, move({ x: 400, seq: 1 }), 1200, ON_FOOT_CAP_MPS)).toBe(false);
  });

  it('would rubber-band the same sprint under the old 7 m/s cap (regression guard)', () => {
    const s = state();
    // 160 cm in 200 ms needs > 140 cm budget; the old 7 m/s cap gave only 140 cm, hence corrections.
    expect(checkMovement(s, move({ x: 160, seq: 1 }), 1200, 7)).toBe(false);
  });

  // v2.1 gtasf-v21-personal-rides: a mounted ride moves ~2x sprint; the server cap scales per funding
  // stage (WorldDO uses rideSpeedCapMps) so a legit ride passes, but a plain on-foot cap would reject it.
  it('accepts a ride-speed move at the per-stage ride cap, not at the on-foot cap', () => {
    const unicorn = FUNDING_ROUNDS.find(r => r.id === 'unicorn')!; // grants the segway (17 m/s)
    const rideCap = rideSpeedCapMps(unicorn, ON_FOOT_CAP_MPS);
    // 17 m/s over 200 ms = 340 cm — within the ride cap's budget, past the on-foot sprint cap's 220 cm.
    expect(checkMovement(state(), move({ x: 340, seq: 1 }), 1200, rideCap)).toBe(true);
    expect(checkMovement(state(), move({ x: 340, seq: 1 }), 1200, ON_FOOT_CAP_MPS)).toBe(false);
  });

  it('carries one ride packet of jitter credit without admitting sustained bursts or loosening walking', () => {
    const s = state(), seed = FUNDING_ROUNDS.find(r => r.id === 'seed')!;
    const cap = rideSpeedCapMps(seed, ON_FOOT_CAP_MPS);
    expect(checkMovement(s, move({ seq: 1 }), 1100, cap)).toBe(true);
    // 15 m/s skateboard: two 100 ms positions arrive together after 200 ms.
    expect(checkMovement(s, move({ x: 150, seq: 2 }), 1300, cap)).toBe(true);
    expect(checkMovement(s, move({ x: 300, seq: 3 }), 1300, cap)).toBe(true);
    expect(checkMovement(s, move({ x: 450, seq: 4 }), 1300, cap)).toBe(false);
    expect(checkMovement(s, move({ x: 2000, seq: 4 }), 1400, cap)).toBe(false);
    expect(checkMovement(s, move({ x: 450, seq: 4 }), 1400, cap)).toBe(true);
    const walking = state();
    expect(checkMovement(walking, move({ seq: 1 }), 2000, ON_FOOT_CAP_MPS)).toBe(true);
    expect(walking.carryCm).toBe(75);
  });
});
