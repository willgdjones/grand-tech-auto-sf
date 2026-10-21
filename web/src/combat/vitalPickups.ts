// GTA V pivot — LANE B: health + armour pickups (flag vitalsPickups), the client side. The SERVER owns availability and
// the grant (S2C PICKUP_STATE / COMBAT_VITALS); this only draws each spot (same aura + floating icon style as the
// weapon pickups) and hides it while it's taken.
import * as THREE from 'three';
import { PICKUP_SPOTS, type PickupKind } from '@gtasf/shared/combat/pickups';
import { flags } from '@gtasf/shared/flags';
import { disposePickupModel, medkitModel, vestModel } from './pickupModels';

export interface VitalPickups {
  setAvailable(index: number, available: boolean): void;
  /** `eye` = camera world position: a pickup within NEAR_EYE_M of it hides (critic N14: at the aim boom it filled the corner). */
  update(nowMs: number, eye?: { x: number; y: number; z: number }): void;
  dispose(): void;
}

const HOVER_Y = 1.15, NEAR_EYE_M = 2.5; // the aim camera sits ~2 m behind the player: closer than this a pickup is beside/behind them and fills a corner
const PHONE_SCALE = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches ? 1.3 : 1;
const STYLE: Record<PickupKind, { glyph: string; tint: number }> = { health: { glyph: '❤️', tint: 0x5cff8a }, armour: { glyph: '🛡️', tint: 0x6aa8ff } };

function emojiSprite(glyph: string): THREE.Sprite {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (ctx) { ctx.font = '96px "Apple Color Emoji","Segoe UI Emoji",Arial,sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(glyph, 64, 72); }
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false, toneMapped: false }));
  sprite.scale.set(0.85, 0.85, 0.85);
  return sprite;
}

export function createVitalPickups(options: { scene: THREE.Scene; surfaceHeightAt(x: number, z: number): number; project(lat: number, lon: number): { x: number; z: number } }): VitalPickups {
  const auraGeom = new THREE.CylinderGeometry(0.45, 0.45, 2.0, 18, 1, true);
  const items = PICKUP_SPOTS.map(spot => {
    const p = options.project(spot.lat, spot.lon), style = STYLE[spot.kind];
    const group = new THREE.Group(); group.position.set(p.x, options.surfaceHeightAt(p.x, p.z), p.z); group.frustumCulled = false;
    // Phone (reviewer nit 98784eda): the small portrait view shrinks the pickup to a speck, so draw the aura + model 1.3x.
    // Visual only: the server's PICKUP_RADIUS_M is unchanged.
    if (PHONE_SCALE !== 1) group.scale.setScalar(PHONE_SCALE);
    const aura = new THREE.Mesh(auraGeom, new THREE.MeshBasicMaterial({ color: style.tint, transparent: true, opacity: .22, side: THREE.DoubleSide, depthWrite: false, toneMapped: false }));
    aura.position.y = 1;
    // pickupModels (critic R4): a spinning 3D medkit / vest instead of the emoji sprite.
    const icon: THREE.Object3D = flags.pickupModels ? (spot.kind === 'health' ? medkitModel() : vestModel()) : emojiSprite(style.glyph);
    icon.position.y = HOVER_Y;
    // The aura's front face blended over the opaque model and turned the red cross orange (reviewer nit 98784eda). Draw the
    // model after the aura instead: transparent at opacity 1 (still depth-writing) with a higher renderOrder.
    if (flags.pickupModels) icon.traverse(o => { if (!(o instanceof THREE.Mesh)) return; o.renderOrder = 1; (o.material as THREE.Material).transparent = true; });
    group.add(aura, icon); options.scene.add(group);
    return { group, aura, icon };
  });
  return {
    setAvailable(index, available) { const item = items[index]; if (item) item.group.visible = available; },
    update(nowMs, eye) {
      const spin = (nowMs / 900) % (Math.PI * 2), bob = Math.sin(nowMs / 500) * .08;
      for (const item of items) {
        if (!item.group.visible) continue;
        const g = item.group.position, near = !!eye && Math.hypot(eye.x - g.x, eye.y - (g.y + HOVER_Y), eye.z - g.z) < NEAR_EYE_M * item.group.scale.x;
        item.aura.visible = item.icon.visible = !near;
        item.aura.rotation.y = spin; item.icon.position.y = HOVER_Y + bob; if (flags.pickupModels) item.icon.rotation.y = spin;
      }
    },
    dispose() {
      for (const item of items) {
        options.scene.remove(item.group); (item.aura.material as THREE.Material).dispose();
        if (item.icon instanceof THREE.Sprite) { item.icon.material.map?.dispose(); item.icon.material.dispose(); } else disposePickupModel(item.icon, true);
      }
      auraGeom.dispose();
    },
  };
}
