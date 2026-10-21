import { describe, expect, it } from 'vitest';
import { BufferGeometry, Color, Group, Mesh, MeshLambertMaterial, MeshStandardMaterial, ShaderMaterial, Texture } from 'three';
import { applyRealisticMaterials } from './realisticMaterials';
import { addFoliageCameraFade } from './props/foliageFade';

function scene(shared?: MeshLambertMaterial) {
  const group = new Group();
  const m1 = shared ?? new MeshLambertMaterial({ color: new Color('#886644'), name: 'buildings' });
  const m2 = shared ?? new MeshLambertMaterial({ color: new Color('#334455') });
  const mesh1 = new Mesh(new BufferGeometry(), m1);
  const mesh2 = new Mesh(new BufferGeometry(), m2);
  group.add(mesh1, mesh2);
  return { group, mesh1, mesh2, m1 };
}

describe('realistic PBR material conversion', () => {
  it('converts Lambert to MeshStandard, preserves colour, matte non-metal, HD shadows on', () => {
    const { group, mesh1 } = scene();
    const origHex = (mesh1.material as MeshLambertMaterial).color.getHexString();
    applyRealisticMaterials(group, 'hd');
    const mat = mesh1.material as unknown as MeshStandardMaterial;
    expect(mat).toBeInstanceOf(MeshStandardMaterial);
    expect(mat.color.getHexString()).toBe(origHex);
    expect(mat.metalness).toBe(0);
    expect(mat.roughness).toBeGreaterThan(0.5);
    expect(mesh1.castShadow).toBe(true);
    expect(mesh1.receiveShadow).toBe(true);
  });

  it('casts no shadows on Low', () => {
    const { group, mesh1 } = scene();
    applyRealisticMaterials(group, 'low');
    expect(mesh1.material).toBeInstanceOf(MeshStandardMaterial);
    expect(mesh1.castShadow).toBe(false);
    expect(mesh1.receiveShadow).toBe(false);
  });

  it('keeps the street-tree camera fade when converting foliage materials (deploy #6)', () => {
    const group = new Group();
    const tree = new MeshLambertMaterial({ color: new Color('#3a5f2a') });
    addFoliageCameraFade(tree);
    const mesh = new Mesh(new BufferGeometry(), tree);
    group.add(mesh);
    applyRealisticMaterials(group, 'hd');
    const mat = mesh.material as unknown as MeshStandardMaterial;
    expect(mat).toBeInstanceOf(MeshStandardMaterial);
    expect(mat.userData.gtasfFoliageCameraFade).toBe(true);
    expect(mat.customProgramCacheKey()).toContain('foliage-camera-v1');
  });

  it('honours a source userData.gtasfRoughness finish hint (metal street furniture, deploy #6)', () => {
    const group = new Group();
    const furniture = new MeshLambertMaterial({ color: new Color('#8d9493') });
    furniture.userData.gtasfRoughness = 0.58;
    const mesh = new Mesh(new BufferGeometry(), furniture);
    group.add(mesh);
    applyRealisticMaterials(group, 'hd');
    const mat = mesh.material as unknown as MeshStandardMaterial;
    expect(mat.roughness).toBe(0.58);
    expect(mat.metalness).toBe(0);
  });

  it('leaves line materials (overhead wires) untouched (gtasf-52y8)', () => {
    const group = new Group();
    // LineSegments2 extends Mesh and rides on a LineMaterial; the converter must skip it or the
    // wires (LineSegmentsGeometry) are destroyed. Simulate with the three.js isLineMaterial flag.
    const line = new MeshLambertMaterial({ color: new Color('#303c38') });
    (line as unknown as { isLineMaterial: boolean }).isLineMaterial = true;
    const mesh = new Mesh(new BufferGeometry(), line);
    mesh.castShadow = false;
    group.add(mesh);
    applyRealisticMaterials(group, 'hd');
    expect(mesh.material).toBe(line);       // not swapped for a MeshStandardMaterial
    expect(mesh.castShadow).toBe(false);    // shadow flags left as-is
  });

  it('leaves ShaderMaterials unconverted (custom shaders e.g. night-light pools, gtasf-iomr)', () => {
    const group = new Group();
    // A ShaderMaterial can't become a MeshStandardMaterial without losing its program; the converter
    // must skip it (otherwise convert() reads absent color/map and the custom shader is destroyed).
    const shader = new ShaderMaterial({ vertexShader: 'void main(){gl_Position=vec4(position,1.0);}', fragmentShader: 'void main(){gl_FragColor=vec4(1.0);}' });
    const mesh = new Mesh(new BufferGeometry(), shader);
    group.add(mesh);
    applyRealisticMaterials(group, 'hd');
    expect(mesh.material).toBe(shader);
  });

  it('leaves userData.gtasfUnlit materials unconverted (signal lenses, gtasf-h0mi)', () => {
    const group = new Group();
    // A self-luminous lens opts out of the PBR upgrade so it stays full-bright, not a dull lit disc.
    const lens = new MeshLambertMaterial({ color: new Color('#f24932') });
    lens.userData.gtasfUnlit = true;
    const mesh = new Mesh(new BufferGeometry(), lens);
    group.add(mesh);
    applyRealisticMaterials(group, 'hd');
    expect(mesh.material).toBe(lens);
  });

  it('preserves imported PBR MeshStandard materials (Meshy GLB hero pieces) with their maps intact', () => {
    const group = new Group();
    // A Meshy GLB storefront/bay-window arrives already PBR with normal/rough/metal maps; re-converting
    // it would drop those maps and force a matte default, flattening the model. It must be left as-is.
    const pbr = new MeshStandardMaterial({ name: 'meshy storefront', metalness: 0.4, roughness: 0.35 });
    pbr.normalMap = new Texture(); pbr.roughnessMap = new Texture(); pbr.metalnessMap = new Texture();
    const mesh = new Mesh(new BufferGeometry(), pbr);
    mesh.castShadow = true;
    group.add(mesh);
    const restore = applyRealisticMaterials(group, 'hd');
    expect(mesh.material).toBe(pbr);                                   // same object, not re-converted
    expect((mesh.material as MeshStandardMaterial).normalMap).not.toBeNull();
    expect((mesh.material as MeshStandardMaterial).metalnessMap).not.toBeNull();
    expect((mesh.material as MeshStandardMaterial).metalness).toBe(0.4); // not forced to the matte default
    expect(mesh.castShadow).toBe(true);                                // its own shadow flags left as-is
    restore();
  });

  it('de-duplicates a shared source material to one PBR material', () => {
    const shared = new MeshLambertMaterial({ color: new Color('white') });
    const { group, mesh1, mesh2 } = scene(shared);
    applyRealisticMaterials(group, 'hd');
    expect(mesh1.material).toBe(mesh2.material);
  });

  it('restores the original materials and shadow flags', () => {
    const { group, mesh1, m1 } = scene();
    mesh1.castShadow = false;
    const restore = applyRealisticMaterials(group, 'hd');
    expect(mesh1.material).toBeInstanceOf(MeshStandardMaterial);
    restore();
    expect(mesh1.material).toBe(m1);
    expect(mesh1.castShadow).toBe(false);
  });
});
