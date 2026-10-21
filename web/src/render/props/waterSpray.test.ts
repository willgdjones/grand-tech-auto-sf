import { describe, expect, it } from 'vitest';
import { Group, Points } from 'three';
import { createWaterSpray } from './waterSpray';

describe('water spray', () => {
  it('bursts, moves droplets, recycles after its life, and respects the pool size', () => {
    const scene = new Group();
    const spray = createWaterSpray(scene, 2);
    expect(spray.activeCount).toBe(0);

    spray.burst(1, 2, 3);
    expect(spray.activeCount).toBe(1);
    // the active burst's Points node is positioned at the burst origin and visible
    const active = scene.children.find((o): o is Points => o instanceof Points && o.visible)!;
    expect([active.position.x, active.position.y, active.position.z]).toEqual([1, 2, 3]);

    const before = active.geometry.getAttribute('position').getY(0);
    spray.update(0.05);
    expect(active.geometry.getAttribute('position').getY(0)).not.toBe(before); // droplets moved

    spray.burst(0, 0, 0); spray.burst(5, 5, 5); // pool of 2: third burst is a no-op
    expect(spray.activeCount).toBe(2);

    for (let i = 0; i < 20; i++) spray.update(0.05); // > LIFE total -> all recycled
    expect(spray.activeCount).toBe(0);
    spray.destroy();
    expect(scene.children.length).toBe(0);
  });
});
