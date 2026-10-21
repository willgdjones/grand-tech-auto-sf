import { describe, expect, it } from 'vitest';
import { emptyFrame, readGamepads, resolveFrame } from './input';
describe('unified device sampling', () => {
  it('virtual neutral overrides stuck physical movement, mouse and action state', () => {
    const physical = emptyFrame(); physical.move.y = 1; physical.look.x = 4; physical.actions.add('horn'); physical.throttle = 1;
    const result = resolveFrame(physical, {});
    expect(result.move).toEqual({ x: 0, y: 0 }); expect(result.look.x).toBe(0);
    expect(result.actions.size).toBe(0); expect(result.throttle).toBe(0);
  });
  it('normalizes diagonal movement while keeping independent analog driving controls', () => {
    const result = resolveFrame(emptyFrame(), { move: { x: 1, y: 1 }, steer: -.5, throttle: .6, brake: .2, actions: ['handbrake'] });
    expect(Math.hypot(result.move.x, result.move.y)).toBeCloseTo(1);
    expect(result).toMatchObject({ steer: -.5, throttle: .6, brake: .2 }); expect(result.actions.has('handbrake')).toBe(true);
  });
  it('reads triggers, deadzones, right-stick dt and standard gamepad actions', () => {
    const buttons = Array.from({ length: 16 }, (_, i) => ({ pressed: i === 2, touched: false, value: i === 7 ? .7 : i === 6 ? .3 : 0 }));
    const pad = { connected: true, axes: [.1, -.5, .5, 0], buttons };
    const result = resolveFrame(readGamepads([null, pad], .1), null);
    expect(result).toMatchObject({ steer: 0, throttle: .7, brake: .3 });
    expect(result.move.y).toBe(.5); expect(result.look.x).toBeCloseTo(.13); expect(result.actions.has('enter-exit')).toBe(true);
  });
});

describe('caller-owned gamepad sampling output', () => {
  it('clears reused vectors/actions while calls without a buffer preserve independent snapshots', () => {
    const buttons=Array.from({length:16},(_,i)=>({pressed:i===4,touched:false,value:i===7?.8:i===6?.2:0}));
    const pad={connected:true,axes:[.4,-.5,.3,-.2],buttons};
    const out=emptyFrame(), move=out.move, look=out.look, actions=out.actions;
    const snapshot=readGamepads([pad],.1);
    const active=readGamepads([pad],.1,out);
    expect(active).toBe(out); expect(active.move).toBe(move); expect(active.look).toBe(look); expect(active.actions).toBe(actions);
    expect(active).toMatchObject({move:{x:.4,y:.5},steer:.4,throttle:.8,brake:.2});
    expect(active.actions.has('horn')).toBe(true);
    expect(readGamepads([],0,out)).toBe(out);
    expect(out).toEqual(emptyFrame());
    expect(snapshot).toMatchObject({move:{x:.4,y:.5},steer:.4,throttle:.8,brake:.2});
    expect(snapshot.actions.has('horn')).toBe(true);
    expect(snapshot.actions).not.toBe(out.actions);
    const independent=readGamepads([],0);
    expect(independent).not.toBe(snapshot); expect(independent.actions).not.toBe(snapshot.actions);
  });
});
