import { expect, it } from 'vitest';
import { BufferGeometry, Float32BufferAttribute, Mesh, MeshBasicMaterial, Raycaster, Vector3 } from 'three';
import { MeshData, upward } from '../src/pipeline/meshes';
import { createSurfaceJoins } from '../src/pipeline/surfaceJoins';
import type { XYZ } from '../src/pipeline/types';

it('closes visible hill and road-ground cracks without moving surfaces or closing grade-separated levels', () => {
  const terrain = new MeshData(), roads = new MeshData();
  function quad(mesh: MeshData, x0: number, z0: number, x1: number, z1: number, height: (z: number) => number) {
    const p: XYZ[] = [[x0, height(z0), z0], [x1, height(z0), z0], [x1, height(z1), z1], [x0, height(z1), z1]];
    mesh.add(upward(p[0]!, p[1]!, p[2]!), [.2, .21, .22]); mesh.add(upward(p[0]!, p[2]!, p[3]!), [.2, .21, .22]);
  }
  quad(terrain, 0, 4, 8, 8, () => 0);
  quad(roads, 0, 0, 4, 4, () => .1);
  quad(roads, 4, 0, 8, 4, z => .1 + z * .05);
  quad(roads, 8, 0, 12, 4, () => 6);
  const before = JSON.stringify([terrain, roads]), joined = createSurfaceJoins(terrain, roads);
  expect(JSON.stringify([terrain, roads])).toBe(before);
  const geometry = new BufferGeometry().setAttribute('position', new Float32BufferAttribute(joined.triangles.flatMap(t => t.points.flat()), 3));
  const mesh = new Mesh(geometry, new MeshBasicMaterial()); mesh.updateMatrixWorld(true);
  const hits = (from: XYZ, toward: XYZ) => new Raycaster(new Vector3(...from), new Vector3(...toward), 0, 2).intersectObject(mesh).length;
  expect(hits([2, .05, 5], [0, 0, -1])).toBeGreaterThan(0); // ground -> lifted road edge
  expect(hits([3, .15, 3], [1, 0, 0])).toBeGreaterThan(0); // lower road -> hillside junction
  expect(hits([7, 3, 2], [1, 0, 0])).toBe(0); // bridge clearance stays open
  expect(joined.rejectedWidePairs).toBeGreaterThan(0);
  geometry.dispose(); mesh.material.dispose();

  // Actual quantized Potrero faces 94, 288 and 289. Face 288 collapsed
  // onto the lower road boundary, so it must not conceal that exposed edge.
  const a: XYZ = [911.2153080843532, 30.9179671620838, 2405.913266396069];
  const b: XYZ = [911.816888943144, 31.031337992492446, 2413.7181920834987];
  const c: XYZ = [911.4614093447676, 30.9179671620838, 2409.0930509353925];
  const junction = { positions: [
    [904.8323007904294, 30.929164281136508, 2406.393749809259], b, a,
    c, a, a, a, c, [917.4342478713339, 30.910269142735068, 2402.2139347514267],
  ].flat(), indices: Array.from({ length: 9 }, (_, i) => i), colours: new Array<number>(27).fill(51) };
  const original = JSON.stringify(junction), repair = createSurfaceJoins({ positions: [], indices: [], colours: [] }, junction);
  expect(JSON.stringify(junction)).toBe(original);
  const patched = new Mesh(new BufferGeometry().setAttribute('position', new Float32BufferAttribute(repair.triangles.flatMap(t => t.points.flat()), 3)), new MeshBasicMaterial());
  patched.updateMatrixWorld(true);
  const nativeRay = new Raycaster(new Vector3(929.1745541624564, 34.645224126025596, 2406.77), new Vector3(-.9738703130023069, -.20325274042310973, .10131602520472673), .05, 25);
  expect(nativeRay.intersectObject(patched).length).toBeGreaterThan(0);
  patched.geometry.dispose(); patched.material.dispose();

  // Native Columbus pixels (554,700) and (537,740): clipped edge endpoints
  // differ by millimetres in XZ while their height gap is below 5 mm.
  const columbus = { positions: [
    [-205.79143650624104, 25.18411984618671, -1772.897854548784],
    [-199.37327188940094, 25.259923566393013, -1775.808099612415],
    [-201.60771507919554, 25.18411984618671, -1777.741752372814],
    [-199.99829096346934, 25.106986236152224, -1779.468367564928],
    [-201.60771507919554, 25.18411984618671, -1777.741752372814],
    [-199.99829096346934, 25.239088625751517, -1776.3510849330119],
  ].flat(), indices: [0, 1, 2, 3, 4, 5], colours: new Array<number>(18).fill(51) };
  const beforeColumbus = JSON.stringify(columbus);
  const columbusJoins = createSurfaceJoins({ positions: [], indices: [], colours: [] }, columbus);
  expect(JSON.stringify(columbus)).toBe(beforeColumbus);
  const translation: XYZ = [-128, 38.9835, -1664], scale: XYZ = [128, 14.525500000000001, 128];
  const encodedPoint = (point: XYZ) => point.map((n, axis) => translation[axis]! +
    Math.round((n - translation[axis]!) / scale[axis]! * 32767) / 32767 * scale[axis]!);
  const oldRoad = new Mesh(new BufferGeometry().setAttribute('position', new Float32BufferAttribute(columbus.positions, 3)), new MeshBasicMaterial());
  const newJoins = new Mesh(new BufferGeometry().setAttribute('position', new Float32BufferAttribute(columbusJoins.triangles.flatMap(t => t.points.flatMap(encodedPoint)), 3)), new MeshBasicMaterial());
  oldRoad.updateMatrixWorld(true); newJoins.updateMatrixWorld(true);
  for (const direction of [[.7936901467280866, -.43599304452714177, .4242240164237546], [.786210276765548, -.4740732138678545, .3963937292657948]] as XYZ[]) {
    const ray = new Raycaster(new Vector3(-206.48803470726196, 28.75570760541028, -1779.8465375765943), new Vector3(...direction), .05, 15);
    expect(ray.intersectObject(oldRoad)).toHaveLength(0);
    expect(ray.intersectObject(newJoins).length).toBeGreaterThan(0);
  }
  for (const part of [oldRoad, newJoins]) { part.geometry.dispose(); part.material.dispose(); }
});
