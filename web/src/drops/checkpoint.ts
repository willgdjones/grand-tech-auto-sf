import {
  CanvasTexture, ConeGeometry, CylinderGeometry, DoubleSide, Group, Mesh, MeshBasicMaterial, RingGeometry,
  Sprite, SpriteMaterial, SRGBColorSpace, type Scene, type Vector3,
} from 'three';
import { flags } from '@gtasf/shared/flags';
import { DROP_RADIUS_M, type LiveFundDrop } from '@gtasf/shared/drops';
import { SA_COLORS, SA_FONTS, drawOutlinedText } from '../theme/saText';
import type { DropsClient } from './client';

// SA gold tones for the gate/ring/arrow (three.js hex); label fills use the SA palette strings.
const GOLD = 0xf6a81e, GOLD_RING = 0xf0b429, CLAIMED = 0x8fae82, CLOSED = 0x9a8a5a;

/** Draws the fund name onto a canvas sprite so it floats, readable from the street, above the gate. */
function makeLabel(): { sprite: Sprite; set(text: string, colour: string): void; dispose(): void } {
  const canvas = document.createElement('canvas'); canvas.width = 1024; canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace; // SA palette fills; without this the floating fund name washes out
  const sprite = new Sprite(new SpriteMaterial({ map: texture, transparent: true, depthWrite: false, depthTest: false }));
  sprite.scale.set(26, 6.5, 1);
  let last = '';
  return {
    sprite,
    set(text: string, colour: string) {
      const key = `${text}|${colour}`; if (key === last) return; last = key;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      // SA style: thick black outline under a solid fill, condensed display font (theme/saText).
      drawOutlinedText(ctx, text, 512, 132, { font: `900 128px ${SA_FONTS.display}`, fill: colour,
        outline: SA_COLORS.ink, lineWidth: 16, align: 'center', baseline: 'middle' });
      texture.needsUpdate = true;
    },
    dispose() { texture.dispose(); (sprite.material as SpriteMaterial).dispose(); },
  };
}

/**
 * The GTA-style drive-through gate for the open VC fund drop: a translucent gold cylinder you pass
 * through, a pulsing base ring, and the fund name floating above. Server-authoritative — this is
 * display only; the cheque is recorded when WorldDrops sees the player inside the radius.
 */
export function createDropCheckpoint(options: { scene: Scene | Group; surfaceHeightAt(x: number, z: number): number | null }) {
  if (!flags.fundDrops) return null;
  const root = new Group(); root.name = 'VC fund drop checkpoint'; root.visible = false; options.scene.add(root);
  const gateMat = new MeshBasicMaterial({ color: GOLD, opacity: .16, transparent: true, depthWrite: false, side: DoubleSide, forceSinglePass: true });
  const gate = new Mesh(new CylinderGeometry(DROP_RADIUS_M, DROP_RADIUS_M, 7, 40, 1, true), gateMat);
  gate.position.y = 3.5;
  const ringMat = new MeshBasicMaterial({ color: GOLD_RING, opacity: .85, transparent: true, depthWrite: false, side: DoubleSide, forceSinglePass: true });
  const ring = new Mesh(new RingGeometry(DROP_RADIUS_M - 1, DROP_RADIUS_M, 48), ringMat);
  ring.rotation.x = -Math.PI / 2; ring.position.y = .3;
  const label = makeLabel(); label.sprite.position.y = 9.5;
  // A bobbing downward chevron, the classic GTA "go here" cue, readable from a distance.
  const arrowMat = new MeshBasicMaterial({ color: GOLD, transparent: true, opacity: .92, depthWrite: false });
  const arrow = new Mesh(new ConeGeometry(1.7, 3.2, 4), arrowMat);
  arrow.rotation.x = Math.PI; arrow.rotation.y = Math.PI / 4; arrow.position.y = 6.6;
  root.add(gate, ring, arrow, label.sprite);

  let disposed = false, groundedId = '', grounded = false, sampledAt = -Infinity;
  function ground(drop: LiveFundDrop): boolean {
    const height = options.surfaceHeightAt(drop.anchor.x, drop.anchor.z);
    if (height === null) return false;
    root.position.set(drop.anchor.x, height, drop.anchor.z);
    return true;
  }
  return {
    root,
    update(client: DropsClient, now = performance.now(), cameraPos?: Vector3) {
      if (disposed) return;
      const drop = client.nearest?.drop ?? client.active[0];
      if (!drop) { root.visible = false; groundedId = ''; return; }
      if (drop.id !== groundedId) { groundedId = drop.id; grounded = false; sampledAt = -Infinity; }
      if (!grounded && now - sampledAt > 200) { sampledAt = now; grounded = ground(drop); }
      root.visible = grounded;
      if (!grounded) return;
      // dropGateNoInsideWash: the translucent gate cylinder covers the whole view when the camera is inside the ring
      // (you drive/walk through it — DROP_RADIUS_M is a generous 12 m). Hide just the cylinder wall while the camera
      // is within (or right at) the volume, keeping the ground ring, arrow, floating label, radar blip and banner as
      // the marker, so being inside the drop never tints the screen. The +2 m / height margins catch the camera as
      // it crosses the wall. Flag off keeps the old always-on wall.
      const cx = cameraPos ? cameraPos.x - root.position.x : Infinity, cz = cameraPos ? cameraPos.z - root.position.z : Infinity;
      const cy = cameraPos ? cameraPos.y - root.position.y : Infinity;
      const cameraInside = flags.dropGateNoInsideWash && cameraPos !== undefined
        && Math.hypot(cx, cz) < DROP_RADIUS_M + 2 && cy > -1.5 && cy < 8.5;
      gate.visible = !cameraInside;
      const yours = drop.yourClaim && drop.yourClaim.position > 0;
      const out = !yours && drop.remaining <= 0;
      const colour = yours ? CLAIMED : out ? CLOSED : GOLD;
      gateMat.color.setHex(colour); ringMat.color.setHex(yours ? CLAIMED : out ? CLOSED : GOLD_RING);
      const pulse = out ? .5 : .8 + Math.sin(now / 260) * .18;
      ringMat.opacity = pulse; gateMat.opacity = out ? .08 : .12 + Math.sin(now / 320) * .05;
      ring.rotation.z += out ? 0 : .01;
      // The arrow points the way until the player has claimed or the drop is spent.
      arrow.visible = !yours && !out;
      arrowMat.color.setHex(GOLD);
      arrow.position.y = 6.6 + Math.sin(now / 300) * .55;
      arrow.rotation.y += .02;
      label.set(drop.fundName, yours ? '#bfe6a3' : out ? '#cfcfcf' : SA_COLORS.titleGold);
      label.sprite.material.opacity = out ? .7 : 1;
      // The floating fund name (a 26 m sprite at ~9.5 m) is a read-from-the-street marker; standing AT the drop
      // (inside the ring, where you pitch) it fills the view and clips off the top of the frame. Hide it once the
      // camera is within the ring — the HUD banner + ground ring + arrow already mark the spot up close.
      label.sprite.visible = Math.hypot(cx, cz) > DROP_RADIUS_M;
    },
    destroy() {
      if (disposed) return; disposed = true; root.removeFromParent();
      gate.geometry.dispose(); gateMat.dispose(); ring.geometry.dispose(); ringMat.dispose();
      arrow.geometry.dispose(); arrowMat.dispose(); label.dispose();
    },
  };
}
export type DropCheckpoint = NonNullable<ReturnType<typeof createDropCheckpoint>>;
