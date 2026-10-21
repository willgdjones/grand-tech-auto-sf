import { expect, it } from 'vitest';
import { Vector2, Vector3 } from 'three';
import { createPlacedLandmarks, disposeLandmark } from '../landmarks/landmarks';
import { prepareWorldGeometry } from '../foundation';
import { createLandmarkWireCollision, createWireRibbons, saggedWire, wireClearsBuildings } from './wires';

it('keeps complete sagged wires outside source and authored facades with a bounded depth-tested ribbon', () => {
  const cable = saggedWire([0, 10, 0], [40, 14, 0], 2);
  expect(cable[0]).toEqual([0, 10, 0]); expect(cable.at(-1)).toEqual([40, 14, 0]);
  expect(cable[4]).toEqual([20, 10, 0]);
  // A facade between the coarse curve vertices must still reject the whole span.
  expect(wireClearsBuildings(cable, (x, _y, _z, radius) => Math.abs(x - 2.5) <= radius + .05)).toBe(false);
  expect(wireClearsBuildings(cable, () => false)).toBe(true);

  const landmarks = createPlacedLandmarks({ enabled: true, ids: ['ferry-building'], heightAt: () => 3.2 });
  const ferry = landmarks.children[0]!, collision = createLandmarkWireCollision(landmarks);
  const world = (x: number, y: number, z: number) => new Vector3(x, y, z).applyMatrix4(ferry.matrixWorld).toArray() as [number, number, number];
  expect(wireClearsBuildings(saggedWire(world(-110, 10, 0), world(110, 10, 0), 1), collision)).toBe(false);
  // The authored plaza extends to z=79, but clear street-side wires are retained.
  expect(wireClearsBuildings(saggedWire(world(-110, 10, 50), world(110, 10, 50), 1), collision)).toBe(true);
  ferry.position.y += 30;
  expect(collision(...world(0, 10, 0), .6, 1.2)).toBe(false); // Collision reads live terrain placement.

  const wires = createWireRibbons(8), material = wires.mesh.material;
  expect(wires.add(cable)).toBe(true); expect(wires.add([[0, 0, 0], [1, 0, 0]])).toBe(false);
  wires.flush(); expect(wires.mesh.geometry.instanceCount).toBe(8);
  expect(material.linewidth).toBeGreaterThanOrEqual(1); expect(material.depthTest).toBe(true);
  // The ribbon width math divides by resolution.y; a (0,0) default makes every
  // wire NaN and invisible. onBeforeRender must sync it to the drawing buffer.
  expect(material.resolution.x).toBeGreaterThan(0); expect(material.resolution.y).toBeGreaterThan(0);
  const onBeforeRender = wires.mesh.onBeforeRender as unknown as (r: { getDrawingBufferSize(t: Vector2): Vector2 }) => void;
  onBeforeRender({ getDrawingBufferSize: (t: Vector2) => { t.set(1280, 720); return t; } });
  expect(material.resolution.x).toBe(1280); expect(material.resolution.y).toBe(720);
  const unmount = prepareWorldGeometry(wires.mesh); expect(wires.mesh.material).toBe(material); unmount();
  wires.reset(); wires.flush(); expect(wires.mesh.geometry.instanceCount).toBe(0);
  wires.destroy(); disposeLandmark(landmarks);
});
