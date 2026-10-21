/**
 * The player's startup on an in-world billboard (PLAN step 3: "the camera swings to a billboard on the
 * Embarcadero facing the Ferry plaza, and the startup name + a generated lettermark logo appear on it").
 *
 * A free-standing board placed at the real nearest Embarcadero billboard surface (sf-bb-embarcadero-09,
 * shared/content/billboards.ts), ~60 m from the Ferry spawn, nudged off the wall into the open and faced
 * back at the plaza so the camera swing frames it. The sign face is an UNLIT MeshBasicMaterial with
 * toneMapped off (the landmark-signage pattern, e.g. outbidCrown.ts) so the startup name reads at face
 * value on HD and Low at noon / golden / night without blooming out. The CanvasTexture is painted once
 * (on creation / name change), never per frame.
 *
 * The 3D mesh is mounted by main.ts (which owns the scene/camera); the pure sign-face painter is exported
 * so the look harness renders the exact same texture.
 */
import {
  BoxGeometry, CanvasTexture, DoubleSide, Group, LinearFilter, Mesh, MeshBasicMaterial, type Object3D,
  PlaneGeometry, SRGBColorSpace, Vector3,
} from 'three';
import { fundingRound } from '@gtasf/shared/funding';
import { placePoint } from '../spawn/locations';
import { lettermark } from './logo';

/** The nearest real Embarcadero billboard surface to the Ferry spawn (shared/content/billboards.ts). */
export const FOUNDER_BILLBOARD = Object.freeze({ id: 'sf-bb-embarcadero-09', lat: 37.794832, lon: -122.394663 });

const TEX_W = 1024, TEX_H = 512;
const BOARD_W = 11, BOARD_H = 5.5; // metres (free-standing hero board, legible on the camera swing)
/** How far in front of the spawn to stand the board (toward the Embarcadero surface, but close enough
 *  to read on the swing — the real surface is ~60 m away, too far for the startup name to be legible). */
const STAND_DISTANCE_M = 24;

/** Greedy word-wrap to at most `maxLines` lines that each fit `maxWidth`, measured in the given font. */
function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (ctx.measureText(candidate).width <= maxWidth || !line) line = candidate;
    else { lines.push(line); line = word; if (lines.length === maxLines - 1) break; }
  }
  if (line && lines.length < maxLines) lines.push(line);
  return lines.slice(0, maxLines);
}

/** Paint the startup's billboard creative onto `canvas` (the exact texture the 3D board shows).
 *  `subtitle` defaults to the Idea stage; city boards pass the startup's own stage label. */
export function paintFounderBillboard(canvas: HTMLCanvasElement, name: string, subtitle?: string): void {
  canvas.width = TEX_W; canvas.height = TEX_H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const mark = lettermark(name);
  // Panel background + gold border band.
  ctx.fillStyle = '#10201a'; ctx.fillRect(0, 0, TEX_W, TEX_H);
  ctx.fillStyle = '#f0b429'; ctx.fillRect(0, 0, TEX_W, 14); ctx.fillRect(0, TEX_H - 14, TEX_W, 14);
  // Lettermark badge.
  const badge = 220, bx = 64, by = (TEX_H - badge) / 2;
  ctx.fillStyle = mark.bg;
  ctx.beginPath(); ctx.roundRect(bx, by, badge, badge, 44); ctx.fill();
  ctx.fillStyle = mark.fg; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = `900 118px Haettenschweiler, 'Arial Narrow Bold', Impact, sans-serif`;
  ctx.fillText(mark.initials, bx + badge / 2, by + badge / 2 + 6);
  // Startup name (auto-shrink to ≤2 lines) + tagline.
  const tx = bx + badge + 56, tw = TEX_W - tx - 56;
  ctx.textAlign = 'left';
  let size = 150, lines: string[] = [];
  do { ctx.font = `900 ${size}px Haettenschweiler, 'Arial Narrow Bold', Impact, sans-serif`;
    lines = wrap(ctx, name.toUpperCase(), tw, 2);
    if (lines.length <= 1 || size <= 72) break; size -= 6;
  } while (size > 72);
  ctx.fillStyle = '#fffbe9';
  const lineH = size * 1.02, blockH = lines.length * lineH;
  let ty = TEX_H / 2 - blockH / 2 + lineH / 2 - 22;
  ctx.textBaseline = 'middle';
  for (const line of lines) { ctx.fillText(line, tx, ty); ty += lineH; }
  ctx.fillStyle = '#f0b429';
  ctx.font = `700 34px Arial, sans-serif`;
  ctx.fillText((subtitle ?? `${fundingRound(0n).label} · San Francisco`).toUpperCase(), tx, ty + 6);
}

export interface FounderBillboardDeps {
  /** Persistent scene group to attach to (e.g. main.ts `landmarks`). Added post-mount: no PBR re-run. */
  root: Object3D;
  /** World height sampler + chunk ensure (main.ts `world`). */
  world: { surfaceHeightAt(x: number, z: number): number | null; ensureAround(point: { x: number; z: number }): Promise<void> };
  /** The startup name to show. */
  name: string;
  /** A point the board should face (the spawn/plaza), so the camera swing frames it. */
  faceToward: { x: number; z: number };
  /** openingDrive: stand the board on the line toward this point instead of the real Embarcadero billboard (whose line
   *  from the drive start runs down the roadway, so the board stood in the car's path). */
  toward?: { x: number; z: number };
}

export interface FounderBillboard {
  /** World-space centre of the sign face, for the camera to look at. */
  readonly center: Vector3;
  dispose(): void;
}

/** Build and mount the player's startup billboard; resolves once its chunk is loaded and it is placed. */
export async function createFounderBillboard(deps: FounderBillboardDeps): Promise<FounderBillboard> {
  // Stand the board on the line from the spawn toward the real Embarcadero surface, but ~24 m out so the
  // camera swing can read the startup name (the surface itself is ~60 m away — illegible at that range).
  const surface = deps.toward ?? placePoint(FOUNDER_BILLBOARD);
  const ex = surface.x - deps.faceToward.x, ez = surface.z - deps.faceToward.z, ed = Math.hypot(ex, ez) || 1;
  const reach = Math.min(STAND_DISTANCE_M, ed);
  const px = deps.faceToward.x + (ex / ed) * reach, pz = deps.faceToward.z + (ez / ed) * reach;
  await deps.world.ensureAround({ x: px, z: pz });
  const groundY = deps.world.surfaceHeightAt(px, pz) ?? 0;
  const panelCenterY = 7; // local height of the sign-face centre above the ground
  const yaw = Math.atan2(deps.faceToward.x - px, deps.faceToward.z - pz); // +Z normal faces the spawn/plaza

  const group = new Group();
  group.name = 'Founder startup billboard';
  group.position.set(px, groundY, pz);
  group.rotation.y = yaw;

  // Sign face: unlit, tone-mapped off, so the name reads bright on HD + Low regardless of time of day.
  const canvas = document.createElement('canvas');
  paintFounderBillboard(canvas, deps.name);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace; texture.magFilter = LinearFilter; texture.needsUpdate = true;
  const faceMaterial = new MeshBasicMaterial({ map: texture, toneMapped: false, side: DoubleSide });
  faceMaterial.userData.gtasfUnlit = true;
  const face = new Mesh(new PlaneGeometry(BOARD_W, BOARD_H), faceMaterial);
  face.position.set(0, panelCenterY, 0.22); // clearly in front of the frame box so it is never occluded
  group.add(face);

  // Dark frame behind the face (authored border/support, not a bare placeholder box). Its front face
  // sits behind the sign face, so the textured face always reads.
  const frameMaterial = new MeshBasicMaterial({ color: '#0c1813' });
  frameMaterial.userData.gtasfUnlit = true;
  const frame = new Mesh(new BoxGeometry(BOARD_W + 0.5, BOARD_H + 0.5, 0.3), frameMaterial);
  frame.position.set(0, panelCenterY, 0); // front face at z=0.15, behind the sign face at z=0.22
  group.add(frame);
  const postH = panelCenterY - BOARD_H / 2;
  for (const sx of [-BOARD_W * 0.33, BOARD_W * 0.33]) {
    const post = new Mesh(new BoxGeometry(0.42, postH, 0.42), frameMaterial);
    post.position.set(sx, postH / 2, 0);
    group.add(post);
  }

  deps.root.add(group);
  const center = new Vector3(px, groundY + panelCenterY, pz);

  return {
    center,
    dispose() {
      group.removeFromParent();
      face.geometry.dispose(); faceMaterial.dispose(); texture.dispose();
      frame.geometry.dispose(); frameMaterial.dispose();
      for (const child of group.children) if (child instanceof Mesh) child.geometry.dispose();
    },
  };
}
