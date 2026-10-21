import { describe, expect, it } from 'vitest';
import { Group, Mesh } from 'three';
import { createRideSystem } from './rideSystem';
import { createRemoteRides } from './remoteRides';

const round = (id: string) => ({ id });

describe('ride system', () => {
  it('keeps the local and remote mounted model aligned with upgrades and down rounds', () => {
    const scene = new Group(), remoteScene = new Group();
    const local = createRideSystem(scene), remote = createRemoteRides(remoteScene);
    const pose = { x: 12, y: 3, z: -7, yaw: .7 };
    const visible = (root: Group) => root.children[0]!.children.filter(child => child.visible);
    local.toggle(round('bootstrapping'));
    local.update(pose);
    for (const [stage, id, speed] of [
      ['bootstrapping', 'scooter', 14], ['seed', 'skateboard', 15], ['series-a', 'ebike', 16],
      ['series-d', 'onewheel', 17], ['unicorn', 'segway', 17], ['bootstrapping', 'scooter', 14],
    ] as const) {
      expect(local.mountSpeed(round(stage))).toBe(speed);
      expect(local.ride?.id).toBe(id);
      remote.update(9, pose, round(stage), true);
      for (const root of [scene, remoteScene]) {
        expect(visible(root).map(mesh => mesh.name)).toEqual([id]);
        expect(visible(root)[0]!.position.toArray()).toEqual([pose.x, pose.y, pose.z]);
        expect(visible(root)[0]!.rotation.y).toBeCloseTo(pose.yaw);
      }
      expect(local.mounted).toBe(true);
    }
    local.dismount(); remote.update(9, pose, round('unicorn'), false);
    local.syncRound(round('unicorn'));
    expect(local.mountSpeed(round('unicorn'))).toBe(0);
    expect(visible(scene)).toEqual([]); expect(visible(remoteScene)).toEqual([]);
    local.destroy(); remote.destroy();
    expect(scene.children).toEqual([]); expect(remoteScene.children).toEqual([]);
  });
  it('toggles the fastest unlocked ride on/off and feeds its speed', () => {
    const rs = createRideSystem(new Group());
    expect(rs.mounted).toBe(false);
    expect(rs.mountSpeed(round('bootstrapping'))).toBe(0); // on foot
    rs.toggle(round('bootstrapping'));
    expect(rs.mounted).toBe(true);
    expect(rs.ride?.id).toBe('scooter');
    expect(rs.mountSpeed(round('bootstrapping'))).toBeGreaterThan(8); // ~2x the 8 m/s sprint
    rs.toggle(round('bootstrapping')); // stow
    expect(rs.mounted).toBe(false);
    expect(rs.mountSpeed(round('bootstrapping'))).toBe(0);
    rs.destroy();
  });

  it('grants a faster ride at a higher funding round and dismounts cleanly', () => {
    const rs = createRideSystem(new Group());
    rs.toggle(round('unicorn'));
    expect(rs.ride?.id).toBe('segway');
    rs.dismount();
    expect(rs.mounted).toBe(false);
    expect(rs.mountSpeed(round('unicorn'))).toBe(0);
    rs.destroy();
  });

  it('spins the mounted ride wheels as the player travels', () => {
    const scene = new Group();
    const rs = createRideSystem(scene);
    rs.toggle(round('bootstrapping')); // scooter
    rs.update({ x: 0, y: 0, z: 0, yaw: 0 }); // first update seeds last position, no spin
    rs.update({ x: 0, y: 0, z: 2, yaw: 0 }); // travelled 2 m -> wheels roll
    let spun = false;
    scene.traverse((o) => { if (o instanceof Mesh && Math.abs(o.rotation.x) > 1e-3) spun = true; });
    expect(spun).toBe(true);
    rs.dismount();
    rs.update({ x: 0, y: 0, z: 4, yaw: 0 }); // dismounted -> no further spin / no throw
    rs.destroy();
  });

  it('adds its mesh to the scene and removes it on destroy', () => {
    const scene = new Group();
    const before = scene.children.length;
    const rs = createRideSystem(scene);
    expect(scene.children.length).toBe(before + 1);
    rs.destroy();
    expect(scene.children.length).toBe(before);
  });
});
