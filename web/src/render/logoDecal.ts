import { DoubleSide, Group, Mesh, MeshStandardMaterial, PlaneGeometry, SRGBColorSpace, type Texture, TextureLoader } from 'three';

/**
 * Startup-logo decals (founder startup-logo-upload feature, gtasf-startup-logo-decal). Pane 12 slice:
 * render a player's moderated logo as a decal on their car (both front doors) and personal ride (deck
 * badge). This module is intentionally only the RENDERER + a texture loader; it takes a ready three
 * Texture, so it is independent of how the logo is uploaded/cropped/moderated/stored (worker + HUD
 * panes) — the stable contract between us is "a per-player logo Texture".
 *
 * Integration (pane 1 / upload pane), gated on flags.startupLogos:
 *   const tex = await loadLogoTexture(player.logoUrl);          // R2 URL, post-moderation
 *   const decal = createLogoDecal(tex, CAR_DECAL_PLACEMENTS);   // or RIDE_DECAL_PLACEMENTS
 *   carRoot.add(decal.root);                                    // dispose() on teardown
 * The same per-player Texture also feeds the paintball splat (pane 1) and nameplate/cap-table badge.
 */

export interface DecalPlacement {
  x: number; y: number; z: number;
  /** Plane faces +z by default; rx/ry rotate it to sit on the target surface (metres, radians). */
  rx?: number; ry?: number;
  /** Square decal edge length in metres. */
  size?: number;
}

export interface LogoDecal { root: Group; dispose(): void }

/** Minimal loader shape so the real TextureLoader and test doubles both satisfy it. */
type TextureLoaderLike = { loadAsync(url: string): Promise<Texture> };

/** Load a moderated startup logo (square WebP <=256px from R2) as a decal-ready texture. */
export async function loadLogoTexture(url: string, loader: TextureLoaderLike = new TextureLoader() as TextureLoaderLike): Promise<Texture> {
  const texture = await loader.loadAsync(url);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

/** Build a decal Group (one textured plane per placement, sharing one material) for a vehicle/ride. */
export function createLogoDecal(texture: Texture, placements: readonly DecalPlacement[]): LogoDecal {
  const root = new Group(); root.name = 'startup-logo-decal';
  const material = new MeshStandardMaterial({ map: texture, transparent: true, alphaTest: 0.4, roughness: 0.6, metalness: 0, side: DoubleSide });
  const geometries: PlaneGeometry[] = [];
  for (const p of placements) {
    const size = p.size ?? 0.5;
    const geometry = new PlaneGeometry(size, size); geometries.push(geometry);
    const mesh = new Mesh(geometry, material);
    mesh.position.set(p.x, p.y, p.z);
    mesh.rotation.set(p.rx ?? 0, p.ry ?? 0, 0);
    root.add(mesh);
  }
  return {
    root,
    dispose() { for (const g of geometries) g.dispose(); material.dispose(); },
  };
}

/** Both front doors of a car, facing outward (car ~1.85 m wide; decal sits on the door panel). */
export const CAR_DECAL_PLACEMENTS: readonly DecalPlacement[] = Object.freeze([
  { x: 0.95, y: 0.82, z: 0.2, ry: Math.PI / 2, size: 0.5 },   // right door
  { x: -0.95, y: 0.82, z: 0.2, ry: -Math.PI / 2, size: 0.5 }, // left door
]);

/** A small badge flat on a personal ride's deck/board, facing up. */
export const RIDE_DECAL_PLACEMENTS: readonly DecalPlacement[] = Object.freeze([
  { x: 0, y: 0.135, z: -0.05, rx: -Math.PI / 2, size: 0.13 },
]);
