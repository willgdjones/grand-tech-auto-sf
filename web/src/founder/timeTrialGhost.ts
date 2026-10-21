/**
 * Time-trial ghosts (docs/PLAN-gta-pivot.md LANE C). A PERSONAL-BEST ghost, entirely client-side: the runner
 * samples the player's path during a run; on a new best time the path is stored (localStorage, per route); on the
 * next run of that route a translucent "racer" orb replays the stored best, interpolated to the live clock, so the
 * player races their own best pace. No server (a shared-leaderboard ghost can layer on later via the board). The
 * recorder + store are pure-ish; the racer is a cheap unlit orb. Flag-gated with time trials; inert otherwise.
 */
import { Mesh, MeshBasicMaterial, type Object3D, SphereGeometry } from 'three';

export interface GhostSample { readonly ms: number; readonly x: number; readonly z: number }
export interface GhostData { readonly routeId: string; readonly totalMs: number; readonly samples: readonly GhostSample[] }

/** How often (ms) the path is sampled while a run is live — ~4 Hz keeps a lap's trace tiny in localStorage. */
export const GHOST_SAMPLE_MS = 250;
const KEY = (routeId: string) => `gtasf.tt.ghost.${routeId}`;
const MAX_SAMPLES = 1200; // ~5 min at 4 Hz — a guard against a pathological run bloating storage

/** Records the player's path during a run, throttled to GHOST_SAMPLE_MS, and packages it on finish. */
export function createGhostRecorder() {
  let samples: GhostSample[] = [];
  let lastMs = -Infinity;
  return {
    reset() { samples = []; lastMs = -Infinity; },
    sample(ms: number, x: number, z: number) {
      if (ms - lastMs < GHOST_SAMPLE_MS || samples.length >= MAX_SAMPLES) return;
      lastMs = ms; samples.push({ ms, x, z });
    },
    finish(routeId: string, totalMs: number): GhostData { return { routeId, totalMs, samples: [...samples] }; },
  };
}

/** The device's stored personal-best ghost for a route, or null if none / malformed. */
export function loadBestGhost(routeId: string): GhostData | null {
  try {
    const raw = localStorage.getItem(KEY(routeId));
    if (!raw) return null;
    const v = JSON.parse(raw) as GhostData;
    if (typeof v?.totalMs !== 'number' || !Array.isArray(v.samples) || v.samples.length === 0) return null;
    if (!v.samples.every(s => Number.isFinite(s?.ms) && Number.isFinite(s?.x) && Number.isFinite(s?.z))) return null;
    return { routeId, totalMs: v.totalMs, samples: v.samples };
  } catch { return null; }
}

/** Store `ghost` as the personal best only when it beats the stored time (or there is none). Returns true if saved. */
export function saveBestGhost(ghost: GhostData): boolean {
  if (ghost.samples.length === 0) return false;
  const current = loadBestGhost(ghost.routeId);
  if (current && current.totalMs <= ghost.totalMs) return false;
  try { localStorage.setItem(KEY(ghost.routeId), JSON.stringify(ghost)); return true; } catch { return false; }
}

/** The interpolated {x,z} along a ghost's samples at `elapsedMs` (clamped to the ends). */
export function ghostPositionAt(samples: readonly GhostSample[], elapsedMs: number): { x: number; z: number } {
  if (samples.length === 1 || elapsedMs <= samples[0]!.ms) return { x: samples[0]!.x, z: samples[0]!.z };
  const last = samples[samples.length - 1]!;
  if (elapsedMs >= last.ms) return { x: last.x, z: last.z };
  let i = 1;
  while (i < samples.length && samples[i]!.ms < elapsedMs) i++;
  const a = samples[i - 1]!, b = samples[i]!;
  const span = b.ms - a.ms || 1, t = (elapsedMs - a.ms) / span;
  return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
}

/** The ghost's elapsed-ms when it was nearest to `(x, z)` — i.e. "at this spot on the route, your best run was at
 *  this time". The HUD subtracts the live elapsed from it for the "vs best" delta (+ behind / − ahead). Point-to-
 *  point routes only (no self-crossings), which the three routes are. Null for an empty ghost. */
export function ghostTimeAtPosition(samples: readonly GhostSample[], x: number, z: number): number | null {
  if (samples.length === 0) return null;
  let bestMs = samples[0]!.ms, bestD = Infinity;
  for (const s of samples) { const d = (s.x - x) ** 2 + (s.z - z) ** 2; if (d < bestD) { bestD = d; bestMs = s.ms; } }
  return bestMs;
}

export interface GhostRacer {
  /** Begin replaying `ghost` (hides any previous). */
  show(ghost: GhostData): void;
  /** Move the orb to the ghost's position at `elapsedMs`. No-op when hidden. */
  update(elapsedMs: number): void;
  hide(): void;
  dispose(): void;
}

/** A translucent gold orb that replays a ghost path. `heightAt` lifts it onto the ground (the samples are x/z only). */
export function createGhostRacer(deps: { root: Object3D; heightAt(x: number, z: number): number | null }): GhostRacer {
  const mesh = new Mesh(
    new SphereGeometry(0.55, 16, 12),
    new MeshBasicMaterial({ color: 0xf0b429, transparent: true, opacity: 0.5, toneMapped: false, depthWrite: false }),
  );
  mesh.renderOrder = 9; mesh.visible = false; mesh.name = 'Time-trial ghost racer';
  deps.root.add(mesh);
  let active: GhostData | null = null;
  return {
    show(ghost) { active = ghost; mesh.visible = true; },
    update(elapsedMs) {
      if (!active) return;
      const p = ghostPositionAt(active.samples, elapsedMs);
      const y = deps.heightAt(p.x, p.z);
      mesh.position.set(p.x, (y ?? mesh.position.y) + 1.4, p.z);
    },
    hide() { active = null; mesh.visible = false; },
    dispose() { mesh.removeFromParent(); mesh.geometry.dispose(); (mesh.material as MeshBasicMaterial).dispose(); },
  };
}
