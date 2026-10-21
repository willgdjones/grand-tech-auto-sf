/**
 * GTA V pivot — LANE B (combat & police): free weapon pickups in the world (flag gunShop). A handful of fixed
 * SF spots each float a weapon's emoji over a glowing aura; walk into one and it grants that weapon (refilling
 * its magazine) GTA-style, then respawns after a cooldown. The paid gun shop (Lead Capital, the weapon wheel's
 * buy flow) still matters for immediate access + stage pricing; pickups are the hidden free finds.
 *
 * Plain three.js, no art dependency — the aura + emoji sprite read as an intentional game pickup, not a bare
 * box. giveWeapon is the Combat hook; byte-inert when the flag is off (main.ts never creates this).
 */
import * as THREE from 'three';
import { flags } from '@gtasf/shared/flags';
import { disposePickupModel, weaponPickupModel } from './pickupModels';
import { WEAPONS, type WeaponId } from '@gtasf/shared/combat/weapons';

export interface WeaponPickupSpot { weapon: WeaponId; x: number; z: number }
export interface WeaponPickups {
  /** `eye` = camera world position: a pickup within NEAR_EYE_M of it hides (critic N14). */
  update(player: { x: number; z: number }, nowMs: number, eye?: { x: number; y: number; z: number }): void;
  dispose(): void;
}

const PICKUP_RADIUS = 1.9;   // metres — walk this close to grab
const RESPAWN_MS = 25_000;   // reappears this long after being grabbed
const HOVER_Y = 1.15;        // emoji floats this high over the ground
const NEAR_EYE_M = 2.5;      // critic N14: closer than this to the camera (aim cam ~2 m behind the player) a pickup fills a corner
const AURA_TINT: Record<string, number> = { melee: 0x8ad0ff, pistol: 0xffe08a, smg: 0xffb04a, rifle: 0xff6a5a };

function emojiSprite(glyph: string): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.font = '96px "Apple Color Emoji","Segoe UI Emoji",Arial,sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(glyph, 64, 72);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false, toneMapped: false }));
  sprite.scale.set(0.9, 0.9, 0.9);
  return sprite;
}

export function createWeaponPickups(options: {
  scene: THREE.Scene;
  surfaceHeightAt(x: number, z: number): number;
  spots: readonly WeaponPickupSpot[];
  giveWeapon(id: WeaponId): void;
  onNotify?(text: string): void;
}): WeaponPickups {
  const { scene, surfaceHeightAt, spots, giveWeapon, onNotify } = options;
  const auraGeom = new THREE.CylinderGeometry(0.45, 0.45, 2.0, 18, 1, true);

  const pickups = spots.map(spot => {
    const group = new THREE.Group();
    const groundY = surfaceHeightAt(spot.x, spot.z);
    group.position.set(spot.x, groundY, spot.z);
    group.frustumCulled = false;
    const tint = AURA_TINT[WEAPONS[spot.weapon].kind] ?? 0xffffff;
    const aura = new THREE.Mesh(auraGeom, new THREE.MeshBasicMaterial({ color: tint, transparent: true, opacity: 0.2, side: THREE.DoubleSide, depthWrite: false, toneMapped: false }));
    aura.position.y = 1.0;
    // pickupModels (critic R4): lane D's procedural weapon model, spinning, instead of the emoji sprite.
    const icon: THREE.Object3D = (flags.pickupModels ? weaponPickupModel(spot.weapon) : null) ?? emojiSprite(WEAPONS[spot.weapon].icon);
    icon.position.y = HOVER_Y;
    group.add(aura, icon);
    scene.add(group);
    return { spot, group, aura, icon, groundY, takenUntil: 0 };
  });

  return {
    update(player: { x: number; z: number }, nowMs: number, eye?: { x: number; y: number; z: number }): void {
      const spin = (nowMs / 900) % (Math.PI * 2);
      const bob = Math.sin(nowMs / 500) * 0.08;
      for (const p of pickups) {
        if (p.takenUntil > nowMs) { if (p.group.visible) p.group.visible = false; continue; }
        if (!p.group.visible) p.group.visible = true;
        const g = p.group.position, near = !!eye && Math.hypot(eye.x - g.x, eye.y - (g.y + HOVER_Y), eye.z - g.z) < NEAR_EYE_M;
        p.aura.visible = p.icon.visible = !near;
        p.aura.rotation.y = spin;
        p.icon.position.y = HOVER_Y + bob;
        if (!(p.icon instanceof THREE.Sprite)) p.icon.rotation.y = spin;
        const dx = player.x - p.spot.x, dz = player.z - p.spot.z;
        if (dx * dx + dz * dz <= PICKUP_RADIUS * PICKUP_RADIUS) {
          giveWeapon(p.spot.weapon);
          onNotify?.(`Picked up the ${WEAPONS[p.spot.weapon].name}.`);
          p.takenUntil = nowMs + RESPAWN_MS;
          p.group.visible = false;
        }
      }
    },
    dispose(): void {
      for (const p of pickups) {
        scene.remove(p.group);
        (p.aura.material as THREE.Material).dispose();
        if (p.icon instanceof THREE.Sprite) { const mat = p.icon.material; mat.map?.dispose(); mat.dispose(); }
        else disposePickupModel(p.icon, false); // weapon material copies are cached/shared
      }
      auraGeom.dispose();
    },
  };
}
