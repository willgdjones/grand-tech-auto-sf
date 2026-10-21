import { flags } from '@gtasf/shared/flags';
import type { Camera, Group, Scene, WebGLRenderer } from 'three';
import type { GoogleWorldFrame } from './coordinates';

export interface GoogleTilesOptions {
  scene: Scene; renderer: WebGLRenderer; landmarks: Group; frame: GoogleWorldFrame; low: boolean;
  /** Independent authored street point, used only to align the visual vertical datum. */
  roadAnchor(x: number, z: number): { x: number; y: number; z: number; yaw: number } | null;
}
export type GoogleTilesStatus = 'loading' | 'aligning' | 'streaming' | 'missing-key' | 'unavailable' | 'disposed';
export interface GoogleTilesHandle {
  update(camera: Camera, player: { x: number; z: number }, now: number): void;
  dispose(): void;
}

/** Keep the renderer and its decoder out of the boot path with no key, even in an enabled preview. */
export function createGoogleTiles(options: GoogleTilesOptions): GoogleTilesHandle | null {
  if (!flags.graphicsV2 || !flags.googleTiles) return null;
  const panel = document.createElement('div'); panel.className = 'gt-google-tiles';
  panel.setAttribute('role', 'complementary'); panel.setAttribute('aria-label', 'Basemap attribution');
  panel.style.cssText = 'display:block;box-sizing:border-box;text-shadow:none;top:auto;left:auto;position:fixed;right:8px;bottom:calc(8px + env(safe-area-inset-bottom));z-index:80;max-width:min(520px,calc(100vw - 16px));padding:6px 10px;background:rgba(255,255,255,.94);color:#202124;font:12px/1.4 Arial,sans-serif;border-radius:2px;pointer-events:none';
  const label = document.createElement('strong'), sources = document.createElement('span');
  label.style.cssText = 'font-weight:500;font-size:14px'; sources.style.display = 'block';
  panel.append(label, sources); document.body.append(panel);
  let disposed = false, runtime: GoogleTilesHandle | undefined;
  function status(state: GoogleTilesStatus, attribution = '') {
    if (disposed) return;
    panel.dataset.state = state;
    const active = state === 'streaming';
    label.textContent = active ? 'Basemap: Google Maps' : 'Google 3D preview';
    sources.textContent = active ? `${attribution}${attribution ? ' · ' : ''}Game overlays: GTASF`
      : state === 'missing-key' ? 'Key not configured — using the GTASF map.'
      : state === 'unavailable' ? 'Tiles unavailable — using the GTASF map.'
      : 'Loading tiles — using the GTASF map until coverage is ready.';
  }
  const key = import.meta.env.VITE_GOOGLE_MAPS_KEY?.trim();
  status(key ? 'loading' : 'missing-key');
  if (key) void import('./runtime').then(({ createGoogleTilesRuntime }) => {
    if (!disposed) runtime = createGoogleTilesRuntime(options, key, status);
  }).catch(() => status('unavailable')); // Never log credential-bearing library errors/URLs.
  return {
    update(camera, player, now) { runtime?.update(camera, player, now); },
    dispose() { if (disposed) return; disposed = true; runtime?.dispose(); panel.remove(); },
  };
}
