/**
 * Translucent car glass for the Meshy traffic cars (gtasf-ieoj, flag trafficDrivers). Each car is ONE opaque body
 * mesh with its windows baked into the texture (no glass material or geometry), so a seated driver was invisible.
 * The window texels are found in the shader: dark albedo, inside the greenhouse band of the body's height, and not
 * facing straight up/down (keeps a black roof/sill opaque). The body then draws in two passes that share the
 * geometry: opaque with the glass texels discarded, plus a tinted translucent pane pass over just those texels.
 * Bodies are already double-sided, so the inner panels show through the glass.
 *
 * Materials are shared per original material (one opaque + one pane variant per car type, one program each), and
 * only cars that carry a driver get them, so the cost is bounded by the driver pool.
 */
import { Color, Mesh, Vector3, type Material, type MeshLambertMaterial, type MeshStandardMaterial, type Object3D, Vector2 } from 'three';

/** The fleet is Lambert on graphicsV2 (vehicle.ts demotePbrToLambert) and Standard on the legacy HD path. */
type BodyMaterial = MeshLambertMaterial | MeshStandardMaterial;

/** Glass is the top of the body (window line to the roof edge) where the surface isn't flat (keeps the
 *  roof), and, per type, darker than `dark` (linear luma; keeps bright paint/trim). The outback paints its windows a
 *  light mint, so it skips the colour test. Measured from side-view height bands (tools/_driver-showroom.mjs). */
interface GlassTuning { belt: number; top: number; dark: number }
const DEFAULT_TUNING: GlassTuning = { belt: .63, top: .9, dark: .3 };
// The box top includes roof furniture (prius fin, cab sign), so the window band differs per type.
const TUNING: Record<string, Partial<GlassTuning>> = { model3: { belt: .66, top: .94 }, cab: { belt: .52, top: .75 }, outback: { dark: 9 } };
const TINT = new Color(.03, .04, .05), ALPHA = .62; // dark enough to hide the hollow shell, light enough for a driver
/** Debug view for the look tool: paint the pane pass solid red to show exactly which texels classify as glass. */
let debugRed = false;
export function setCarGlassDebug(on: boolean): void { debugRed = on; }
/** Look-tool A/B: off = cars keep their opaque single pass (drivers stay hidden behind the baked windows). */
let enabled = true;
export function setCarGlassEnabled(on: boolean): void { enabled = on; }

interface Variant { opaque: BodyMaterial; pane: BodyMaterial }
const variants = new WeakMap<Material, Variant>();

function inject(material: BodyMaterial, box: Vector2, tuning: GlassTuning, pane: boolean) {
  material.onBeforeCompile = shader => {
    shader.uniforms.uCarBox = { value: box };
    shader.uniforms.uCarBand = { value: new Vector3(tuning.belt, tuning.top, tuning.dark) };
    shader.uniforms.uCarTint = { value: TINT };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vCarLocal; varying vec3 vCarN;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvCarLocal = position; vCarN = normal;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vCarLocal; varying vec3 vCarN; uniform vec2 uCarBox; uniform vec3 uCarBand; uniform vec3 uCarTint;')
      .replace('#include <map_fragment>', `#include <map_fragment>
        float carY = (vCarLocal.y - uCarBox.x) / max(1e-5, uCarBox.y - uCarBox.x);
        bool carGlass = carY > uCarBand.x && carY < uCarBand.y && dot(diffuseColor.rgb, vec3(.2126, .7152, .0722)) < uCarBand.z
          && abs(normalize(vCarN).y) < .9;
        ${pane ? `if (!carGlass) discard; diffuseColor = ${debugRed ? 'vec4(1., 0., 0., 1.)' : `vec4(uCarTint, ${ALPHA.toFixed(3)})`};` : 'if (carGlass) discard;'}`);
  };
  material.customProgramCacheKey = () => pane ? `car-glass-pane${debugRed ? '-debug' : ''}` : 'car-glass-opaque';
}

function variantFor(mesh: Mesh, assetId: string): Variant | undefined {
  const original = mesh.material as BodyMaterial;
  const kind = original as { isMeshStandardMaterial?: boolean; isMeshLambertMaterial?: boolean };
  if (Array.isArray(original) || !(kind.isMeshStandardMaterial || kind.isMeshLambertMaterial) || !original.map) return undefined;
  const cached = variants.get(original);
  if (cached) return cached;
  mesh.geometry.computeBoundingBox();
  const bb = mesh.geometry.boundingBox!, box = new Vector2(bb.min.y, bb.max.y);
  const opaque = original.clone(), pane = original.clone();
  const tuning = { ...DEFAULT_TUNING, ...TUNING[assetId] };
  inject(opaque, box, tuning, false); inject(pane, box, tuning, true);
  pane.transparent = true; pane.depthWrite = false; pane.emissive = new Color(0); pane.emissiveMap = null; pane.normalMap = null;
  if ('roughness' in pane) { pane.roughness = .08; pane.metalness = 0; }
  const variant = { opaque, pane };
  variants.set(original, variant);
  return variant;
}

const PANE = 'car-glass-pane';
/** Swap every textured body mesh under `root` to glass (idempotent: also picks up a level added later, e.g. the
 *  carNearDetail HD level). Returns false when there was nothing new to do. */
export function applyCarGlass(root: Object3D): boolean {
  if (!enabled) return false;
  let changed = false;
  root.traverse(object => {
    if (!(object instanceof Mesh) || object.name === PANE || object.userData.carGlass) return;
    const variant = variantFor(object, root.name);
    if (!variant) return;
    const pane = new Mesh(object.geometry, variant.pane); pane.name = PANE; pane.renderOrder = 1; pane.castShadow = false;
    pane.updateMatrix(); pane.matrixAutoUpdate = false;
    object.userData.carGlass = object.material; object.material = variant.opaque; object.add(pane);
    changed = true;
  });
  return changed;
}

/** Undo applyCarGlass (the car's driver left: back to the cheaper single opaque pass). */
export function removeCarGlass(root: Object3D): void {
  const panes: Mesh[] = [];
  root.traverse(object => {
    if (!(object instanceof Mesh)) return;
    if (object.name === PANE) { panes.push(object); return; }
    if (object.userData.carGlass) { object.material = object.userData.carGlass; delete object.userData.carGlass; }
  });
  for (const pane of panes) pane.removeFromParent();
}
