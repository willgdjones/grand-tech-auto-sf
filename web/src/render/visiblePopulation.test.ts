import { expect, it } from 'vitest';
import { Bone, BoxGeometry, Group, Mesh, MeshBasicMaterial, Raycaster, Scene, Vector3 } from 'three';
import { VisiblePopulation } from './visiblePopulation';

it('resumes hidden crowds and actors with current poses, preserving world queries and picks', () => {
  const scene = new Scene(), parent = new Group(), geometry = new BoxGeometry(), material = new MeshBasicMaterial();
  scene.add(parent);
  const make = (root: Group) => {
    const actor = new Group(), bone = new Bone(), body = new Mesh(geometry, material);
    actor.add(bone); bone.add(body); root.add(actor); parent.add(root);
    return { root, actor, bone, body };
  };
  const low = make(new VisiblePopulation()), ordinary = make(new Group());
  const pose = (x: number, angle: number) => {
    parent.position.set(x, 2, 1);
    for (const crowd of [low, ordinary]) {
      crowd.root.position.x = 2;
      crowd.actor.position.x = 1;
      crowd.bone.rotation.z = angle;
      crowd.body.position.x = .2;
    }
    scene.updateMatrixWorld();
  };
  const equalPose = () => expect(low.body.matrixWorld.elements).toEqual(ordinary.body.matrixWorld.elements);
  try {
    pose(0, 0); equalPose();
    const initial = low.body.matrixWorld.clone();
    low.root.visible = ordinary.root.visible = false;
    pose(10, .7);
    expect(low.body.matrixWorld.equals(initial)).toBe(true);
    expect(low.body.matrixWorld.equals(ordinary.body.matrixWorld)).toBe(false);
    low.root.visible = ordinary.root.visible = true;
    scene.updateMatrixWorld(); equalPose();
    const shown = low.body.matrixWorld.clone();
    low.actor.visible = ordinary.actor.visible = false;
    pose(20, 1.1); expect(low.body.matrixWorld.equals(shown)).toBe(true);
    // Explicit world-space callers still receive current data for a hidden actor.
    expect(low.body.getWorldPosition(new Vector3()).toArray()).toEqual(ordinary.body.getWorldPosition(new Vector3()).toArray());
    pose(30, .3);
    const centre = ordinary.body.getWorldPosition(new Vector3());
    const ray = new Raycaster(centre.clone().add(new Vector3(0, 0, 10)), new Vector3(0, 0, -1));
    const hits = ray.intersectObject(low.root, true).map(hit => hit.distance);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits).toEqual(ray.intersectObject(ordinary.root, true).map(hit => hit.distance));
    low.actor.visible = ordinary.actor.visible = true;
    pose(40, 1.8); equalPose();
    expect(low.root.children).toHaveLength(1);
  } finally { geometry.dispose(); material.dispose(); }
});
