import { expect, it } from 'vitest';
import { BufferGeometry, Float32BufferAttribute, Group, Mesh, MeshStandardMaterial, Uint8BufferAttribute } from 'three';
import { geodeticToWorld } from '../../../tools/map/src/geo';
import { SF_FRAME } from '../../../tools/map/src/config';
import { repairLegacyUrbanGround } from './urbanGround';
import { prepareWorldGeometry } from './foundation';

it('corrects old Howard/Folsom land in both decoded formats while preserving source parks, geometry and release ownership', () => {
  for (const floatColours of [false, true]) for (const [lat, lon, urban] of [
    [37.7840, -122.4010, [138, 140, 135]],
    [37.7599, -122.4148, [125, 120, 110]],
  ] as const) {
    const root = new Group(), [x, z] = geodeticToWorld(lat, lon, SF_FRAME);
    root.position.set(x - 128, 0, z - 128);
    const geometry = new BufferGeometry();
    // Each vertex carries one source surface: ordinary land, park, water, sand, scrub, new urban.
    const bytes = [97,110,71, 66,107,54, 26,59,105, 163,143,99, 84,97,54, ...urban];
    const original = floatColours ? new Float32BufferAttribute(bytes.map(v => v / 255), 3) : new Uint8BufferAttribute(bytes, 3, true);
    const positions = new Float32BufferAttribute([0,0,0, 1,0,0, 0,0,1, 1,0,1, 2,0,0, 2,0,1], 3);
    geometry.setAttribute('position', positions); geometry.setAttribute('color', original); geometry.setIndex([0,1,2,3,4,5]);
    const indices = geometry.index, positionBytes = Array.from(positions.array);
    const source = new MeshStandardMaterial({ vertexColors: true });
    const mesh = new Mesh(geometry, source); mesh.name = 'terrain_2'; mesh.position.set(128, 23, 128); mesh.scale.set(2, 1, 2); root.add(mesh);
    const buildingGeometry = geometry.clone(), building = new Mesh(buildingGeometry, source); building.name = 'buildings'; root.add(building);
    const buildingColours = buildingGeometry.getAttribute('color');
    const disabled = repairLegacyUrbanGround(root, false);
    expect(geometry.getAttribute('color')).toBe(original); disabled();
    // Exercise the real common mount entry used by both Low and realistic rendering.
    const release = prepareWorldGeometry(root), colour = geometry.getAttribute('color');
    expect(colour).toBe(original); // Reuse the buffer that normal chunk disposal will release.
    expect([colour.getX(0), colour.getY(0), colour.getZ(0)].map(v => Math.round(v * 255))).toEqual(urban);
    for (let i = 1; i < original.count; i++) {
      expect([colour.getX(i), colour.getY(i), colour.getZ(i)].map(v => Math.round(v * 255))).toEqual(bytes.slice(i * 3, i * 3 + 3));
    }
    expect(geometry.getAttribute('position')).toBe(positions); expect(Array.from(positions.array)).toEqual(positionBytes);
    expect(geometry.index).toBe(indices); expect(mesh.position.toArray()).toEqual([128,23,128]); expect(mesh.scale.toArray()).toEqual([2,1,2]);
    expect(mesh.material.vertexColors).toBe(true); expect(buildingGeometry.getAttribute('color')).toBe(buildingColours);
    const releaseAgain = repairLegacyUrbanGround(root, true);
    expect(geometry.getAttribute('color')).toBe(colour); releaseAgain();
    release(); release(); expect(geometry.getAttribute('color')).toBe(original); expect(mesh.material).toBe(source);
    expect(Array.from(original.array)).toEqual(floatColours ? Array.from(new Float32Array(bytes.map(v => v / 255))) : bytes);
    root.position.set(-100_000, 0, -100_000);
    const outside = repairLegacyUrbanGround(root, true); expect(geometry.getAttribute('color')).toBe(original); outside();
    geometry.dispose(); buildingGeometry.dispose(); source.dispose();
  }
});
