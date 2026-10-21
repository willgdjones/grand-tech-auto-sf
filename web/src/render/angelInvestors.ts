import { CanvasTexture, Group, Sprite, SpriteMaterial, SRGBColorSpace } from 'three';
import { SA_COLORS, SA_FONTS, drawOutlinedText } from '../theme/saText';
import type { AvatarInstance, AvatarTemplate } from '../avatar/riggedAvatar';
import type { GroundPose, MovementWorld } from '../movement/world';
import { CELEB_NPCS, celebChequeCents, celebLabel, celebRumourFor, type CelebNpc } from '@gtasf/shared/content/celebs';
import { ANGEL_SLOT_MS, ROAMING_ANGELS, angelSpots } from '@gtasf/shared/content/angels';
import { flags } from '@gtasf/shared/flags';

/**
 * Hidden parody angel-investor NPCs (gtasf-v2-angel-npcs-v4i6, PLAN-v2 decision 4).
 *
 * Cosmetic city actors modelled on `ferryPedestrians.ts`: they pace a short loop at a
 * hidden world spot, snap to ground, and are culled by distance. They are NOT added to
 * the map/radar. Each shows a floating "<name> (parody)" tag. Walk up and the host wires
 * the E key to `pitch()`; the content (line + cheque size) comes from shared/content/celebs.
 * The module tracks which NPCs the player has pitched so the cheque pays once per NPC, and
 * surfaces vague rumour hints via `takeRumour()`. The actual money award is the host's job
 * (funding client / server) — this module only reports the validated intent and content.
 */
const angle = (value: number) => Math.atan2(Math.sin(value), Math.cos(value));

export interface PitchTarget {
  readonly npc: CelebNpc;
  readonly distance: number;
  readonly alreadyPitched: boolean;
  /** gtasf-y5vc: true for a fictional roaming angel (voice-pitched); false for a real-person celebrity (one-tap pre-written pitch). */
  readonly roaming: boolean;
}
export interface PitchResult {
  readonly npc: CelebNpc;
  readonly firstTime: boolean;
  /** Integer cents as bigint (review M4), matching the cap-table/funding contract. */
  readonly chequeCents: bigint;
  readonly line: string;
}
export interface AngelInvestors {
  readonly root: Group;
  readonly stats: { readonly count: number; live: number; walking: number };
  update(foot: GroundPose, dt: number): void;
  /** Nearest pitchable NPC within reach (horizontal + vertical), or null. */
  nearest(foot: GroundPose): PitchTarget | null;
  /** HUD line for the prompt footer, or null when nobody is in reach. */
  promptText(foot: GroundPose): string | null;
  /** Report a pitch at the nearest NPC. Does not mark it paid — call markPitched on award success. */
  pitch(foot: GroundPose): PitchResult | null;
  markPitched(id: string): void;
  hasPitched(id: string): boolean;
  /** Seed the already-pitched set from a server/local record. */
  setPitched(ids: Iterable<string>): void;
  pitchedIds(): string[];
  /** A throttled rumour line pointing at a nearby undiscovered NPC's neighbourhood, or null. */
  takeRumour(foot: GroundPose, now: number): string | null;
  /** A faint world zone (x/z metres + radius) around the currently-hinted investor while a rumour is
   * active, for the radar to draw; the NPC itself stays hidden from the map. Null when none is active.
   * Pass the same `now` as takeRumour. (gtasf-radar-rumour-zone-wire-hoc5) */
  activeRumourZone(now: number): { x: number; z: number; radius: number } | null;
  dispose(): void;
}

interface Placed {
  readonly npc: CelebNpc;
  /** Roaming angels (flags.angelNpcs) are re-placed when their 20-minute stop changes. */
  path: readonly (readonly [number, number])[];
  readonly roaming?: true;
  next: number;
  x: number; y: number; z: number;
  yaw: number; speed: number; pace: number; pause: number;
  /** Horizontal distance to the player, refreshed each frame (review H5: avoids wrapper objects). */
  dist: number;
  avatar: AvatarInstance | null;
  label: Sprite | null;
}

const PITCH_RADIUS = 3; // metres, horizontal
const PITCH_VERTICAL = 3; // metres, so you cannot pitch a rooftop NPC from the street
const RUMOUR_RANGE = 170; // metres; hint only when you are roughly in the neighbourhood
const RUMOUR_INTERVAL_MS = 60_000;
const RUMOUR_ZONE_MS = 30_000; // how long the radar rumour zone lingers after a hint fires, then fades
const RUMOUR_ZONE_RADIUS = 150; // metres; a faint "somewhere around here" area, never a pinpoint
const RUMOUR_ZONE_GRID = 50; // metres; mask the investor's exact position and pacing route

/** Build a small pacing loop (a rotated square) around a world spot. */
function pacingLoop(hx: number, hz: number, headingDeg: number): readonly (readonly [number, number])[] {
  const t = (headingDeg * Math.PI) / 180, c = Math.cos(t), s = Math.sin(t);
  const local: readonly (readonly [number, number])[] = [[-2, -2], [2, -2], [2, 2], [-2, 2]];
  return local.map(([lx, lz]) => [hx + lx * c - lz * s, hz + lx * s + lz * c] as const);
}

function makeLabel(text: string): Sprite {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d')!;
  // SA HUD theme via the shared web/src/theme module (SwiftBay: all panes adopt it): flat black
  // pause-menu panel, square corners, uppercase gold display title with a thick black outline.
  const dpr = 2, display = text.toUpperCase();
  const font = `900 ${20 * dpr}px ${SA_FONTS.display}`, padX = 14 * dpr, padY = 8 * dpr;
  context.font = font;
  const width = Math.ceil(context.measureText(display).width) + padX * 2;
  const height = 28 * dpr + padY * 2;
  canvas.width = width; canvas.height = height;
  context.fillStyle = SA_COLORS.panel;
  context.fillRect(0, 0, width, height);
  context.strokeStyle = SA_COLORS.ink; context.lineWidth = 2 * dpr;
  context.strokeRect(dpr, dpr, width - 2 * dpr, height - 2 * dpr);
  drawOutlinedText(context, display, width / 2, height / 2 + dpr,
    { font, fill: SA_COLORS.titleGold, outline: SA_COLORS.ink, lineWidth: 3 * dpr, align: 'center', baseline: 'middle' });
  const texture = new CanvasTexture(canvas);
  // The canvas is painted in sRGB theme colours; without this the renderer skips the sRGB→linear
  // decode and the panel/gold title wash out (matches every other CanvasTexture in render/).
  texture.colorSpace = SRGBColorSpace; texture.anisotropy = 2;
  const sprite = new Sprite(new SpriteMaterial({ map: texture, transparent: true, depthWrite: false, depthTest: true }));
  const metres = 0.55; // label height in world metres
  sprite.scale.set((width / height) * metres, metres, 1);
  sprite.renderOrder = 12;
  sprite.visible = false;
  return sprite;
}

/** Bounded local atmosphere, no network/reward identity of its own. Gated by flags.celebNpcs. */
export function createAngelInvestors(options: {
  enabled: boolean;
  template: AvatarTemplate | null;
  ground: MovementWorld;
  isLoaded(x: number, z: number): boolean;
  geoToWorld(lat: number, lon: number): { x: number; z: number };
  low?: boolean;
  pitched?: Iterable<string>;
}): AngelInvestors | null {
  if (!options.enabled || !options.template) return null;

  const root = new Group();
  root.name = 'Angel investor NPCs';
  const pitched = new Set<string>(options.pitched ?? []);
  const maxLive = options.low ? 3 : 6;
  const pool: AvatarInstance[] = [];
  let created = 0;
  let disposed = false;
  let lastRumourAt = 0, rumourIndex = 0, rumourPick: Placed | null = null;
  let rumourZone: { x: number; z: number; radius: number } | null = null;

  const placed: Placed[] = CELEB_NPCS.map((npc): Placed => {
    const { x, z } = options.geoToWorld(npc.spot[0], npc.spot[1]);
    const path = pacingLoop(x, z, npc.headingDeg);
    const first = path[1]!;
    return {
      npc, path, next: 1, x, y: 0, z,
      yaw: Math.atan2(first[0] - x, first[1] - z),
      speed: 0, pace: 1.1, pause: Math.random() * 0.6, dist: Infinity, avatar: null, label: null,
    };
  });
  // Roaming angels (living map item 8): fictional angels standing outside SF tech places; where each stands is a
  // pure function of time (shared/content/angels.ts), so every client and the server's pitch check agree.
  // Voice-pitch only, so they need flags.pitching too.
  if (flags.angelNpcs && flags.pitching) for (const a of ROAMING_ANGELS) placed.push({
    npc: { id: a.id, name: a.name, neighbourhood: 'outside a tech office', tier: 'angel', spot: [0, 0], headingDeg: 0, outfit: a.outfit, line: a.line } as CelebNpc,
    path: [[Infinity, Infinity]], roaming: true, next: 0, x: Infinity, y: 0, z: Infinity, yaw: 0, speed: 0, pace: 1.1, pause: Math.random() * 0.6,
    dist: Infinity, avatar: null, label: null });
  let roamSlot = -1;
  function placeRoamers(now: number): void {
    const slot = Math.floor(now / ANGEL_SLOT_MS);
    if (slot === roamSlot) return;
    roamSlot = slot;
    const spots = new Map(angelSpots(now).map(s => [s.angel.id, s.stop]));
    for (const p of placed) {
      if (!p.roaming) continue;
      const stop = spots.get(p.npc.id);
      if (p.avatar) release(p);
      // No stop this slot (fewer stops than angels): park off-map so range culling skips it.
      p.x = stop?.x ?? Infinity; p.z = stop?.z ?? Infinity;
      p.path = stop ? pacingLoop(stop.x, stop.z, 0) : [[Infinity, Infinity]]; p.next = stop ? 1 : 0;
    }
  }
  const stats = { count: placed.length, live: 0, walking: 0 };
  // Reused per-frame scratch so update() allocates nothing (review H5): `order` holds the indices
  // of the nearest live NPCs in ascending distance; `liveSet` is cleared, never reallocated.
  const order: number[] = [];
  const liveSet = new Set<Placed>();

  function acquire(outfit: number): AvatarInstance | null {
    const free = pool.pop();
    if (free) { free.setOutfit(outfit); free.root.visible = true; return free; }
    if (created < maxLive && options.template) {
      created++;
      const avatar = options.template.createInstance(outfit);
      avatar.root.name = 'Angel investor';
      root.add(avatar.root);
      return avatar;
    }
    return null;
  }
  function release(p: Placed): void {
    if (p.avatar) { p.avatar.root.visible = false; pool.push(p.avatar); p.avatar = null; }
    if (p.label) p.label.visible = false;
  }

  function distanceTo(foot: GroundPose, p: Placed): number {
    return Math.hypot(foot.x - p.x, foot.z - p.z);
  }

  function step(p: Placed, foot: GroundPose, dt: number): boolean {
    const target = p.path[p.next]!, dx = target[0] - p.x, dz = target[1] - p.z;
    const remaining = Math.hypot(dx, dz), desiredYaw = Math.atan2(dx, dz);
    p.yaw += angle(desiredYaw - p.yaw) * (1 - Math.exp(-7 * dt));
    p.pause = Math.max(0, p.pause - dt);
    const ready = p.pause === 0 && Math.abs(angle(desiredYaw - p.yaw)) < 0.18;
    p.speed = ready ? Math.min(p.pace, p.speed + 2 * dt) : 0;
    const stride = Math.min(remaining, p.speed * dt);
    if (stride <= 0 || remaining <= 0.001) return false;
    const nx = p.x + (dx / remaining) * stride, nz = p.z + (dz / remaining) * stride;
    const nearPlayer = Math.abs(foot.y - p.y) < 2.5 && Math.hypot(nx - foot.x, nz - foot.z) < 1.25;
    const nextY = options.isLoaded(nx, nz) ? options.ground.heightAt(nx, nz) : null;
    if (nearPlayer || nextY === null || !Number.isFinite(nextY) || Math.abs(nextY - p.y) > 0.35
      || options.ground.collidesCircle?.(nx, nz, 0.5)) { p.speed = 0; return false; }
    p.x = nx; p.z = nz; p.y = nextY;
    if (remaining - stride < 0.02) { p.next = (p.next + 1) % p.path.length; p.pause = 0.7 + Math.random() * 0.6; }
    return true;
  }

  function update(foot: GroundPose, seconds: number): void {
    if (disposed) return;
    placeRoamers(Date.now());
    const dt = Math.min(0.1, Math.max(0, Number.isFinite(seconds) ? seconds : 0));
    const range = options.low ? 90 : 150, fadeStart = range - 25;
    stats.live = 0; stats.walking = 0;

    // Pick the nearest in-range, ground-valid NPCs up to the live budget with no per-frame
    // allocation (review H5): distances live on each Placed, selection is an in-place ascending
    // top-N insertion into the reused `order` buffer (N = maxLive ≤ 6, so bubbling is cheap).
    order.length = 0;
    for (let i = 0; i < placed.length; i++) {
      const p = placed[i]!;
      const distance = distanceTo(foot, p);
      p.dist = distance;
      if (distance >= range || !options.isLoaded(p.x, p.z)) continue;
      if (order.length < maxLive) order.push(i);
      else if (distance < placed[order[order.length - 1]!]!.dist) order[order.length - 1] = i;
      else continue;
      for (let j = order.length - 1; j > 0 && placed[order[j]!]!.dist < placed[order[j - 1]!]!.dist; j--) {
        const tmp = order[j]!; order[j] = order[j - 1]!; order[j - 1] = tmp;
      }
    }
    liveSet.clear();
    for (let k = 0; k < order.length; k++) liveSet.add(placed[order[k]!]!);

    for (const p of placed) if (p.avatar && !liveSet.has(p)) release(p);

    for (let k = 0; k < order.length; k++) {
      const p = placed[order[k]!]!;
      const distance = p.dist;
      let y = options.ground.heightAt(p.x, p.z);
      if (y === null || !Number.isFinite(y) || options.ground.collidesCircle?.(p.x, p.z, 0.5)) { release(p); continue; }
      p.y = y;
      if (!p.avatar) p.avatar = acquire(p.npc.outfit);
      if (!p.avatar) continue;
      const moving = step(p, foot, dt);
      y = p.y;
      p.avatar.root.position.set(p.x, y, p.z);
      p.avatar.root.rotation.y = p.yaw;
      const opacity = Math.min(1, Math.max(0, (range - distance) / (range - fadeStart)));
      p.avatar.update(moving ? (dt * p.speed) / 3 : dt, moving ? 'walk' : 'idle', opacity);
      if (!p.label) { p.label = makeLabel(celebLabel(p.npc)); root.add(p.label); }
      p.label.visible = opacity > 0.4;
      p.label.position.set(p.x, y + 2.35, p.z);
      (p.label.material as SpriteMaterial).opacity = opacity;
      stats.live++;
      if (moving) stats.walking++;
    }
  }

  function nearest(foot: GroundPose): PitchTarget | null {
    let best: PitchTarget | null = null;
    for (const p of placed) {
      if (Math.abs(foot.y - p.y) > PITCH_VERTICAL) continue;
      const distance = distanceTo(foot, p);
      if (distance > PITCH_RADIUS) continue;
      if (!best || distance < best.distance) best = { npc: p.npc, distance, alreadyPitched: pitched.has(p.npc.id), roaming: Boolean(p.roaming) };
    }
    return best;
  }

  return {
    root,
    stats,
    update,
    nearest,
    promptText(foot) {
      const target = nearest(foot);
      if (!target) return null;
      const label = celebLabel(target.npc);
      return target.alreadyPitched ? `${label} — already pitched` : `E · Pitch ${label}`;
    },
    pitch(foot) {
      const target = nearest(foot);
      if (!target) return null;
      return {
        npc: target.npc,
        firstTime: !pitched.has(target.npc.id),
        chequeCents: celebChequeCents(target.npc.id),
        line: target.npc.line,
      };
    },
    markPitched(id) { pitched.add(id); },
    hasPitched(id) { return pitched.has(id); },
    setPitched(ids) { pitched.clear(); for (const id of ids) pitched.add(id); },
    pitchedIds() { return [...pitched]; },
    takeRumour(foot, now) {
      if (!(now - lastRumourAt >= RUMOUR_INTERVAL_MS)) return null;
      let pick: Placed | null = null, pickDistance = Infinity;
      for (const p of placed) {
        if (pitched.has(p.npc.id)) continue;
        const distance = distanceTo(foot, p);
        if (distance < RUMOUR_RANGE && distance < pickDistance) { pick = p; pickDistance = distance; }
      }
      if (!pick) return null;
      lastRumourAt = now; rumourPick = pick;
      // Freeze a coarse search area for the whole hint: following a moving centre would reveal
      // the hidden actor's route and invalidate the full-map canvas on every animation frame.
      rumourZone = {
        x: Math.round(pick.x / RUMOUR_ZONE_GRID) * RUMOUR_ZONE_GRID,
        z: Math.round(pick.z / RUMOUR_ZONE_GRID) * RUMOUR_ZONE_GRID,
        radius: RUMOUR_ZONE_RADIUS,
      };
      return celebRumourFor(pick.npc.neighbourhood, rumourIndex++);
    },
    activeRumourZone(now) {
      // Faint zone for RUMOUR_ZONE_MS after a hint fires; clears once pitched or expired. The angel
      // stays hidden (no map marker) — this only hints the general area, as the rumour text already does.
      if (!rumourPick || pitched.has(rumourPick.npc.id) || now - lastRumourAt >= RUMOUR_ZONE_MS) return null;
      return rumourZone;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const p of placed) {
        p.avatar?.dispose();
        if (p.label) {
          root.remove(p.label);
          const material = p.label.material as SpriteMaterial;
          material.map?.dispose();
          material.dispose();
        }
      }
      for (const avatar of pool) avatar.dispose();
      pool.length = 0;
      root.removeFromParent();
      stats.live = 0; stats.walking = 0;
    },
  };
}
