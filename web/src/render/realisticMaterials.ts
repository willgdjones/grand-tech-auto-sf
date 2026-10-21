import { Color, Mesh, MeshStandardMaterial, type Material, type Object3D, type Texture } from 'three';
import type { GraphicsPreset } from './graphicsPreset';
import { addRealisticFacades } from './realisticFacades';
import type { RealisticFacadeAtlas } from './realisticFacadeAtlas';
import type { FacadeGround } from './facadeAtlas';
import { addSurfaceRoof } from './surfaceMaterials';
import { addFoliageCameraFade } from './props/foliageFade';

/** The subset of material properties the realistic conversion reads off the source (PS2) material. */
type SourceMaterial = Material & {
  color?: Color; map?: Texture | null; vertexColors?: boolean;
  emissive?: Color; emissiveMap?: Texture | null; emissiveIntensity?: number;
};

/**
 * Convert a mounted geometry root's MeshLambert/basic materials to `MeshStandardMaterial` (PBR) for
 * the realistic path (pane 9, behind `realisticRender`): keeps colour / map / vertex colours /
 * emissive, sets matte non-metal defaults, and enables shadow cast + receive on HD (none on Low).
 * Materials are de-duplicated so shared source materials map to one PBR material. Returns a restore
 * function that puts the original materials and shadow flags back. Self-contained — no foundation
 * edit required for the base conversion.
 *
 * When a realistic facade `atlas` is supplied (realisticRender + realisticFacades), building wall
 * materials (source name `GTASF buildings`) get the PBR facade shader injected (realisticFacades.ts):
 * procedural per-district styling over an albedo/normal/ARM atlas, with glass curtain walls, storefront
 * bands and window frames. `ground` is the per-chunk sourced terrain height so the storefront band
 * tracks the street; `low` (preset==='low') takes the cheaper albedo-only path.
 */
export function applyRealisticMaterials(root: Object3D, preset: GraphicsPreset, atlas?: RealisticFacadeAtlas, ground?: FacadeGround): () => void {
  const shadows = preset === 'hd';
  const low = preset === 'low';
  const changed: { mesh: Mesh; material: Material | Material[]; castShadow: boolean; receiveShadow: boolean }[] = [];
  const cache = new Map<Material, MeshStandardMaterial>();
  const convert = (source: Material): MeshStandardMaterial => {
    const existing = cache.get(source);
    if (existing) return existing;
    const input = source as SourceMaterial;
    const standard = new MeshStandardMaterial({
      name: `GTASF realistic ${source.name || 'material'}`,
      color: input.color ? input.color.clone() : new Color('white'),
      map: input.map ?? null,
      vertexColors: Boolean(input.vertexColors),
      metalness: 0,
      roughness: 0.92,
      transparent: source.transparent,
      opacity: source.opacity,
      alphaTest: source.alphaTest,
      side: source.side,
      emissive: input.emissive ? input.emissive.clone() : new Color(0, 0, 0),
      emissiveMap: input.emissiveMap ?? null,
      emissiveIntensity: input.emissiveIntensity ?? 1,
    });
    // Building walls get the procedural PBR facade shader instead of a flat matte wall.
    if (atlas && source.name === 'GTASF buildings' && !input.map) addRealisticFacades(standard, atlas, ground, low);
    if (source.name === 'GTASF buildings') addSurfaceRoof(standard, low);
    // Streamed roads are prepared with world-space asphalt/brick/slab tiles, followed by the
    // live night-fill hook. Both use shader chunks shared by Lambert and Standard; keep that
    // exact composition and its borrowed uniforms when upgrading lighting. Do not transfer
    // arbitrary material hooks (e.g. the Lambert-only facade shader) to PBR materials.
    if (source.name === 'GTASF roads') {
      standard.onBeforeCompile = (shader, renderer) => source.onBeforeCompile(shader, renderer);
      standard.customProgramCacheKey = () => `${source.customProgramCacheKey()}:pbr-roads-v1`;
    }
    // Street-tree alpha cards keep their camera-near fade (foliageFade.ts) so nearby leaf cards still
    // dither out instead of snapping to solid crossed billboards right in front of the camera.
    if (source.userData.gtasfFoliageCameraFade) addFoliageCameraFade(standard);
    // A lane can hint a non-matte finish (e.g. metal street furniture reads as clay at the matte
    // default) via source userData, keeping metalness 0 so there is no env-map darkening.
    const roughnessHint = (source.userData as { gtasfRoughness?: unknown }).gtasfRoughness;
    if (typeof roughnessHint === 'number' && roughnessHint >= 0 && roughnessHint <= 1) standard.roughness = roughnessHint;
    cache.set(source, standard);
    return standard;
  };
  root.traverse(object => {
    if (!(object instanceof Mesh)) return;
    // Leave specialized materials alone. Line2/LineSegments2 (e.g. the overhead power/Muni wires) ride
    // on a LineMaterial shader that draws screen-space ribbons from LineSegmentsGeometry, which a
    // MeshStandardMaterial cannot render (converting deletes the wires). A material can also opt out of
    // the PBR upgrade with userData.gtasfUnlit — self-luminous pieces like traffic-signal lenses that
    // must stay full-bright rather than become dull lit surfaces with no emissive.
    const material = object.material;
    const preserve = (m: Material): boolean =>
      Boolean((m as { isLineMaterial?: boolean }).isLineMaterial)
      // A ShaderMaterial/RawShaderMaterial can never be converted: convert() reads color/map/emissive
      // (which it lacks) and the custom shader would be lost — e.g. the night-light additive pool.
      || Boolean((m as { isShaderMaterial?: boolean }).isShaderMaterial)
      // Already-PBR materials are kept intact: converting an imported MeshStandard (e.g. a Meshy GLB
      // hero piece — storefront, bay window) would drop its normal/roughness/metalness/ao maps and force
      // a matte default, flattening the model. World geometry mounts as MeshLambert, so buildings/roads
      // still convert and get the facade shader; only genuine PBR imports are left alone (they set their
      // own shadow flags). [gtasf-realistic-facade-meshy-pieces-xyrw integration]
      || Boolean((m as { isMeshStandardMaterial?: boolean }).isMeshStandardMaterial)
      || Boolean(m.userData?.gtasfUnlit);
    if (Array.isArray(material) ? material.some(preserve) : preserve(material)) return;
    changed.push({ mesh: object, material: object.material, castShadow: object.castShadow, receiveShadow: object.receiveShadow });
    object.material = Array.isArray(object.material) ? object.material.map(convert) : convert(object.material);
    object.castShadow = shadows;
    object.receiveShadow = shadows;
  });
  let released = false;
  return () => {
    if (released) return;
    released = true;
    for (const entry of changed) {
      entry.mesh.material = entry.material;
      entry.mesh.castShadow = entry.castShadow;
      entry.mesh.receiveShadow = entry.receiveShadow;
    }
    for (const material of cache.values()) material.dispose();
  };
}
