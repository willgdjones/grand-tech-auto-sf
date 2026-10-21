/**
 * Tutorial objective beacon (gtasf-n34i): an SA-style gold checkpoint column + ground ring at the
 * current tutorial target, plus pane 8's gold edge arrow with the distance when it is off-screen.
 * Presentation only; the tutorial driver decides the target.
 */
import * as THREE from 'three';
import { SaObjectiveArrow } from '../theme/saMission';

export interface TutorialBeacon {
  /** Show at a world target (metres) or hide with null. */
  setTarget(target: { x: number; y: number; z: number; radius: number } | null): void;
  update(camera: THREE.Camera, from: { x: number; z: number }, now: number): void;
  dispose(): void;
}

/** Vertical alpha gradient so the column fades out upward like an SA marker corona. */
function columnTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas'); canvas.width = 4; canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createLinearGradient(0, 128, 0, 0);
  gradient.addColorStop(0, 'rgba(255,214,90,0.85)');
  gradient.addColorStop(0.35, 'rgba(255,190,60,0.35)');
  gradient.addColorStop(1, 'rgba(255,170,40,0)');
  ctx.fillStyle = gradient; ctx.fillRect(0, 0, 4, 128);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function createTutorialBeacon(scene: THREE.Scene, surfaceHeightAt: (x: number, z: number) => number | null): TutorialBeacon {
  const group = new THREE.Group(); group.visible = false; group.name = 'tutorial-beacon';
  const texture = columnTexture();
  const column = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 14, 32, 1, true),
    new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, fog: false }));
  column.position.y = 7;
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.86, 1, 48),
    new THREE.MeshBasicMaterial({ color: 0xffc83c, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide, fog: false }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.06;
  group.add(column, ring); scene.add(group);
  const arrow = new SaObjectiveArrow();
  const projected = new THREE.Vector3();
  let target: { x: number; y: number; z: number; radius: number } | null = null, arrowShown = false;

  return {
    setTarget(next) {
      if (next?.x === target?.x && next?.z === target?.z) return; // called every frame; only re-place on change
      target = next; group.visible = Boolean(next);
      if (!next) { arrowShown = false; arrow.hide(); return; }
      const ground = surfaceHeightAt(next.x, next.z) ?? next.y;
      group.position.set(next.x, ground, next.z);
      group.scale.set(next.radius, 1, next.radius);
    },
    update(camera, from, now) {
      if (!target) return;
      ring.material.opacity = 0.65 + 0.3 * Math.sin(now / 260);
      column.rotation.y = now / 2000;
      projected.set(target.x, group.position.y + 2, target.z).project(camera);
      const w = innerWidth, h = innerHeight;
      // Behind the camera: mirror so the edge arrow still points the right way round.
      const behind = projected.z > 1;
      const sx = (behind ? -projected.x : projected.x) * 0.5 * w + w / 2, sy = (behind ? projected.y : -projected.y) * 0.5 * h + h / 2;
      const onScreen = !behind && sx >= 0 && sx <= w && sy >= 0 && sy <= h;
      if (onScreen) { if (arrowShown) { arrowShown = false; arrow.hide(); } return; } // the world beacon is visible
      arrowShown = true;
      arrow.update(behind ? (sx < w / 2 ? -10 : w + 10) : sx, sy, { w, h }, { distanceM: Math.hypot(target.x - from.x, target.z - from.z) });
    },
    dispose() { scene.remove(group); texture.dispose(); arrow.el.remove(); },
  };
}
