/**
 * GTA V pivot — LANE B (combat & police): store robberies, client world piece (flag storeRobberies). Each SF
 * store from shared/combat/storeRobbery.ts gets a glowing "💰 Rob" marker; stand inside and hold. The hold is a
 * server-authoritative two-phase flow (review fix 2): robStart records the hold server-side, the ring fills over
 * ROBBERY_HOLD_MS, then robComplete pays only after the server re-checks the elapsed hold + the pose. The client
 * ring is cosmetic; the server owns the timing + proximity. Plain three.js, no art dep; byte-inert when off.
 */
import * as THREE from 'three';
import { flags } from '@gtasf/shared/flags';
import { ROBBERY_HOLD_MS, ROBBERY_RADIUS_M, type StoreSpec } from '@gtasf/shared/combat/storeRobbery';
import { reportGunfire } from './alerts';

export interface WorldStoreSpot extends StoreSpec { x: number; z: number }
export interface StoreRobberies {
  update(player: { x: number; z: number }, nowMs: number): void;
  dispose(): void;
}

const MARKER_Y = 1.25;
const COMPLETE_MARGIN_MS = 250; // overfill the ring slightly so we never POST complete before the server's hold elapses

type Phase = 'idle' | 'starting' | 'holding' | 'completing' | 'done';

function labelSprite(): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 256; canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.font = '64px "Apple Color Emoji","Segoe UI Emoji",Arial,sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('💰', 128, 48);
    ctx.font = 'bold 34px Arial'; ctx.fillStyle = '#ffe9a8';
    ctx.lineWidth = 6; ctx.strokeStyle = 'rgba(8,16,12,0.9)'; ctx.lineJoin = 'round';
    ctx.strokeText('ROB', 128, 100); ctx.fillText('ROB', 128, 100);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false, toneMapped: false }));
  sprite.scale.set(2, 1, 1);
  return sprite;
}

export function createStoreRobberies(options: {
  scene: THREE.Scene;
  surfaceHeightAt(x: number, z: number): number;
  spots: readonly WorldStoreSpot[];
  /** POST rob-start; resolves to the server status ('started' | 'blocked' | 'too-far' | ...). */
  robStart(storeId: string): Promise<string>;
  /** POST rob-complete; resolves to the server status ('robbed' | 'blocked' | 'too-soon' | 'too-far' | ...). */
  robComplete(storeId: string): Promise<string>;
}): StoreRobberies {
  const { scene, surfaceHeightAt, spots, robStart, robComplete } = options;
  const ringGeom = new THREE.RingGeometry(0.6, 0.78, 32);
  const auraGeom = new THREE.CylinderGeometry(ROBBERY_RADIUS_M * 0.6, ROBBERY_RADIUS_M * 0.6, 2.2, 20, 1, true);

  const markers = spots.map(spot => {
    const group = new THREE.Group();
    const groundY = surfaceHeightAt(spot.x, spot.z);
    group.position.set(spot.x, groundY, spot.z);
    group.frustumCulled = false;
    const aura = new THREE.Mesh(auraGeom, new THREE.MeshBasicMaterial({ color: 0xffb300, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false, toneMapped: false }));
    aura.position.y = 1.1;
    const label = labelSprite();
    label.position.y = MARKER_Y + 1.2;
    const ring = new THREE.Mesh(ringGeom, new THREE.MeshBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false, toneMapped: false }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.06; ring.visible = false;
    group.add(aura, label, ring);
    scene.add(group);
    return { spot, group, aura, ring, phase: 'idle' as Phase, holdStartMs: 0, retryAt: 0, backoffMs: 0 };
  });

  return {
    update(player: { x: number; z: number }, nowMs: number): void {
      const bob = Math.sin(nowMs / 500) * 0.06;
      for (const m of markers) {
        if (m.phase === 'done') { if (m.group.visible) m.group.visible = false; continue; }
        m.aura.rotation.y = (nowMs / 1400) % (Math.PI * 2);
        m.group.children[1]!.position.y = MARKER_Y + 1.2 + bob; // the label sprite
        const dx = player.x - m.spot.x, dz = player.z - m.spot.z;
        const inside = dx * dx + dz * dz <= ROBBERY_RADIUS_M * ROBBERY_RADIUS_M;

        if (!inside) { // stepped out: abandon any in-progress hold (server attempt will expire / be overwritten)
          if (m.phase === 'holding' || m.phase === 'starting') m.phase = 'idle';
          m.ring.visible = false;
          continue;
        }
        if (m.phase === 'idle' && nowMs >= m.retryAt) {
          m.phase = 'starting';
          // gtasf-u13gy: a refusal (e.g. 409 not-connected while the world socket is down) backs off 2 s → 15 s
          // instead of re-POSTing every frame (QA saw ~75 rob-starts, each a console error).
          const backOff = () => { m.backoffMs = Math.min(15_000, m.backoffMs ? m.backoffMs * 2 : 2_000); m.retryAt = performance.now() + m.backoffMs; };
          robStart(m.spot.id).then(status => {
            if (m.phase !== 'starting') return; // stepped out while the POST was in flight
            if (status === 'started') { m.phase = 'holding'; m.holdStartMs = performance.now(); m.backoffMs = 0;
              // crowdPanic (critic N37, lane D): a stick-up empties the block like a shot does (the local, cosmetic flee alert).
              if (flags.crowdPanic) reportGunfire(m.spot.x, m.spot.z); }
            else if (status === 'blocked' || status === 'off') m.phase = 'done'; // already robbed today / disabled
            else { m.phase = 'idle'; backOff(); }
          }).catch(() => { if (m.phase === 'starting') { m.phase = 'idle'; backOff(); } });
        }
        // Ring fills during starting (indeterminate small) + holding (real progress).
        const frac = m.phase === 'holding' ? Math.min(1, (nowMs - m.holdStartMs) / (ROBBERY_HOLD_MS + COMPLETE_MARGIN_MS)) : m.phase === 'completing' ? 1 : 0.08;
        m.ring.visible = true;
        m.ring.scale.setScalar(0.4 + frac * 0.9);
        (m.ring.material as THREE.MeshBasicMaterial).opacity = 0.35 + frac * 0.6;
        if (m.phase === 'holding' && frac >= 1) {
          m.phase = 'completing';
          robComplete(m.spot.id).then(status => {
            if (status === 'too-soon') { m.phase = 'holding'; m.holdStartMs = performance.now() - ROBBERY_HOLD_MS; } // retry shortly
            else m.phase = 'done';
          }).catch(() => { m.phase = 'done'; });
        }
      }
    },
    dispose(): void {
      for (const m of markers) {
        scene.remove(m.group);
        (m.aura.material as THREE.Material).dispose();
        (m.ring.material as THREE.Material).dispose();
        const label = m.group.children[1] as THREE.Sprite;
        const mat = label.material as THREE.SpriteMaterial; mat.map?.dispose(); mat.dispose();
      }
      ringGeom.dispose(); auraGeom.dispose();
    },
  };
}
