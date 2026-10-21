import { describe, expect, it } from 'vitest';
import { Group } from 'three';
import { createRemoteRides } from './remoteRides';

const round = (id: string) => ({ id });
const pose = (z: number) => ({ x: 0, y: 0, z, yaw: 0 });

describe('remote rides', () => {
  it('shows a remote ride mesh while riding, hides on dismount, frees on remove', () => {
    const scene = new Group();
    const rr = createRemoteRides(scene);
    rr.update(7, pose(0), round('bootstrapping'), true); // riding -> mesh added to scene
    expect(scene.children.length).toBe(1);
    rr.update(7, pose(2), round('bootstrapping'), false); // stopped riding -> dismounted (group reused, hidden)
    expect(scene.children.length).toBe(1);
    rr.remove(7); // left the world / entered a car -> mesh freed
    expect(scene.children.length).toBe(0);
    rr.destroy();
  });

  it('tracks several riders and cleans them all up on destroy', () => {
    const scene = new Group();
    const rr = createRemoteRides(scene);
    rr.update(1, pose(0), round('unicorn'), true);
    rr.update(2, pose(0), round('seed'), true);
    expect(scene.children.length).toBe(2);
    rr.destroy();
    expect(scene.children.length).toBe(0);
  });
});
