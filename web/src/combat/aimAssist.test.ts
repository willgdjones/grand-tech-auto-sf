import { describe, expect, it } from 'vitest';
import {
  angleTo, createAimAssist, cycleTarget, directionTo, KEYBOARD_CONE_RAD, MOUSE_CONE_RAD, pickTarget, rankTargets, sideAngle, track,
  type AimTarget, type Vec3,
} from './aimAssist';

const eye: Vec3 = { x: 0, y: 1.5, z: 0 };
const north: Vec3 = { x: 0, y: 0, z: -1 }; // -z is north
const at = (x: number, z: number, kind: AimTarget['kind'] = 'ped'): AimTarget => ({ x, y: 1.5, z, kind });

describe('aim assist math', () => {
  it('measures the angle to a target and rejects ones behind', () => {
    expect(angleTo(eye, north, at(0, -10))!.angle).toBeCloseTo(0);
    expect(angleTo(eye, north, at(10, -10))!.angle).toBeCloseTo(Math.PI / 4);
    expect(angleTo(eye, north, at(0, 10))).toBeNull();
  });

  it('magnetises within the cone (measured to the body edge) and not outside it', () => {
    const opts = { coneRad: MOUSE_CONE_RAD, rangeM: 50 };
    expect(pickTarget(eye, north, [at(1.2, -20)], opts)).toBe(0); // ~3.4 deg off centre, ~1.3 deg body: inside
    expect(pickTarget(eye, north, [at(3, -20)], opts)).toBe(-1); // ~8.5 deg: outside the mouse cone
    expect(pickTarget(eye, north, [at(3, -20)], { coneRad: KEYBOARD_CONE_RAD, rangeM: 50 })).toBe(0); // keyboard cone is wider
    expect(pickTarget(eye, north, [at(5, -20)], { coneRad: KEYBOARD_CONE_RAD, rangeM: 50 })).toBe(-1);
  });

  it('respects range and ignores point-blank bodies', () => {
    const opts = { coneRad: 0.2, rangeM: 30 };
    expect(pickTarget(eye, north, [at(0, -40)], opts)).toBe(-1);
    expect(pickTarget(eye, north, [at(0, -0.5)], opts)).toBe(-1);
  });

  it('ranks the target nearest the crosshair first, nearer winning a tie', () => {
    const list = [at(3, -20), at(0.2, -20), at(0, -40), at(0, -10)];
    const order = rankTargets(eye, north, list, { coneRad: 0.3, rangeM: 60 });
    expect(order.slice(0, 2)).toEqual([3, 1]); // both dead on the body edge; 10 m beats 20 m
    expect(order).toContain(0);
  });

  it('screen-right is positive (looking north, east is right)', () => {
    expect(sideAngle(eye, north, at(5, -10))).toBeGreaterThan(0);
    expect(sideAngle(eye, north, at(-5, -10))).toBeLessThan(0);
  });

  it('cycles left to right and wraps', () => {
    const list = [at(-4, -15), at(0, -15), at(4, -15)];
    const opts = { coneRad: 0.5, rangeM: 60 };
    expect(cycleTarget(eye, north, list, -1, opts)).toBe(1);
    expect(cycleTarget(eye, north, list, 1, opts)).toBe(2);
    expect(cycleTarget(eye, north, list, 2, opts)).toBe(0);
    expect(cycleTarget(eye, north, [at(0, -15)], 0, opts)).toBe(-1);
  });

  it('tracks a moving target by its last position', () => {
    expect(track(at(0, -10), [at(5, -10), at(0.4, -10.3)], 2)).toBe(1);
    expect(track(at(0, -10), [at(5, -10)], 2)).toBe(-1);
  });

  it('gives a unit direction', () => {
    const out = { x: 0, y: 0, z: 0 };
    expect(directionTo({ x: 0, y: 0, z: 0 }, { x: 3, y: 4, z: 0 }, out)).toBe(true);
    expect(out).toEqual({ x: 0.6, y: 0.8, z: 0 });
    expect(directionTo(eye, eye, out)).toBe(false);
  });
});

describe('aim assist runtime', () => {
  function rig(targets: AimTarget[], visible = true) {
    const aimed: Vec3[] = [];
    const assist = createAimAssist({
      targets: out => { out.push(...targets); },
      aimAt: (x, y, z) => aimed.push({ x, y, z }),
      view: (e, d) => { Object.assign(e, eye); Object.assign(d, north); },
      rangeM: () => 50,
      visible: () => visible,
      canAim: () => true,
    });
    return { assist, aimed };
  }

  it('Z locks the nearest-to-crosshair visible target, cycles, then releases', () => {
    const targets = [at(-3, -15, 'cop'), at(0.5, -15), at(6, -15, 'player')];
    const { assist, aimed } = rig(targets);
    assist.cycle();
    expect(assist.hard).toBe(true);
    expect(assist.locked).toMatchObject({ x: 0.5 });
    assist.update(1 / 60);
    expect(aimed.at(-1)).toMatchObject({ x: 0.5, z: -15 });
    assist.cycle(); expect(assist.locked).toMatchObject({ kind: 'player' });
    assist.cycle(); expect(assist.locked).toMatchObject({ kind: 'cop' });
  });

  it('does not lock through walls', () => {
    const { assist } = rig([at(0, -15)], false);
    assist.cycle();
    expect(assist.locked).toBeNull();
  });

  it('a lock follows the target and drops when it is gone; a mouse flick breaks it', () => {
    const targets = [at(0, -15)];
    const { assist } = rig(targets);
    assist.cycle();
    targets[0] = at(0.5, -15.5);
    assist.update(0.1);
    expect(assist.locked).toMatchObject({ x: 0.5, z: -15.5 });
    assist.mouseMoved(500);
    expect(assist.locked).toBeNull();
    assist.cycle();
    targets.length = 0;
    assist.update(0.1);
    expect(assist.locked).toBeNull();
  });

  it('soft lock (RMB) needs a target close to the crosshair and releases with the button', () => {
    const { assist } = rig([at(8, -15)]);
    assist.softAcquire();
    expect(assist.locked).toBeNull(); // ~28 deg away: not a soft-lock candidate
    const near = rig([at(1.5, -15)]);
    near.assist.softAcquire();
    expect(near.assist.locked).not.toBeNull();
    expect(near.assist.hard).toBe(false);
    near.assist.softRelease();
    expect(near.assist.locked).toBeNull();
  });

  it('shots bend onto a target inside the magnetism cone', () => {
    const { assist } = rig([at(2, -20)]); // ~5.7 deg: outside the mouse cone, inside the keyboard cone
    expect(assist.shotTarget(eye, north, true)).toBeNull();
    expect(assist.shotTarget(eye, north, false)).toMatchObject({ x: 2 });
  });
});
