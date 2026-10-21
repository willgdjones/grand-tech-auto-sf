import { expect, it } from 'vitest';
import { BoxGeometry, Group, LOD, Mesh, MeshBasicMaterial, PerspectiveCamera, Raycaster, Scene, Vector3 } from 'three';
import { VisibleLod } from './visibleLod';

it('keeps moving/animated LOD switches and hidden-level ray picks equivalent to Three', () => {
  const scene = new Scene(), parent = new Group(), camera = new PerspectiveCamera();
  camera.position.z = 10; camera.updateMatrixWorld(); scene.add(parent);
  const geometry = new BoxGeometry(), material = new MeshBasicMaterial();
  const make = (lod: LOD) => {
    const near = new Group(), wheel = new Mesh(geometry, material), far = new Mesh(geometry, material);
    wheel.position.x = 2; far.position.x = 3; near.add(wheel);
    lod.addLevel(near, 0); lod.addLevel(far, 55, .15); lod.addLevel(new Group(), 350, .1);
    parent.add(lod); return { lod, wheel };
  };
  const cached = make(new VisibleLod()), ordinary = make(new LOD());
  const frame = (x: number, angle: number) => {
    parent.position.x = x;
    cached.wheel.rotation.z = ordinary.wheel.rotation.z = angle;
    scene.updateMatrixWorld(); cached.lod.update(camera); ordinary.lod.update(camera);
    expect(cached.lod.getCurrentLevel()).toBe(ordinary.lod.getCurrentLevel());
    const active = cached.lod.getCurrentLevel();
    expect(cached.lod.levels[active]!.object.matrixWorld.elements)
      .toEqual(ordinary.lod.levels[active]!.object.matrixWorld.elements);
    if (active === 0) expect(cached.wheel.matrixWorld.elements).toEqual(ordinary.wheel.matrixWorld.elements);
  };
  try {
    frame(0, 0); frame(100, .2);
    const dormant = cached.wheel.matrixWorld.clone();
    frame(130, .8);
    expect(cached.wheel.matrixWorld.equals(dormant)).toBe(true);
    const ray = new Raycaster(new Vector3(132, 0, 10), new Vector3(0, 0, -1));
    const hits = ray.intersectObject(cached.lod, true).map(hit => hit.distance);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits).toEqual(ray.intersectObject(ordinary.lod, true).map(hit => hit.distance));
    for (const x of [0, 380, 360, 300, 45, 0]) frame(x, x / 100);
    // Re-showing an externally hidden active level also needs a fresh transform immediately.
    cached.lod.levels[0]!.object.visible = false;
    frame(4, 1.7);
  } finally { geometry.dispose(); material.dispose(); }
});
