import { DataTexture, LinearFilter, RedFormat, UnsignedByteType, Vector2 } from 'three';
import type { ShopfrontContext } from './shopfrontSigns';

// groundContactAO tuning (metres). The terrain/road/kerb shader darkens the ground where this distance is
// small (soft ambient occlusion / contact shadow hugging building bases). RANGE is how far the darkening
// reaches out from a footprint wall; GRID is the coarse per-chunk grid (LinearFilter smooths the ~4 m texels).
const RANGE = 9;  // stored distance saturates to 1.0 at this many metres from the nearest building edge
const GRID = 64;  // coarse grid over the chunk's 256 m extent (~4 m texels)

/** Coarse per-chunk distance-to-nearest-building-edge mask: texel.r = clamp(dist/RANGE, 0, 1)*255, so ~0
 *  hugging a footprint wall and 1.0 beyond RANGE. Built once per chunk at mount (from the chunk's own
 *  building footprints), freed on unload. The shader reads it as a contact-AO term (darken where small).
 *  Pass no context (a chunk with no footprints) to get a 1x1 all-255 texture, so buildDist stays 1.0 and the
 *  AO never fires there. Only the outer ring (rings[0]) is used: it is the silhouette that grounds the mass,
 *  and courtyard interiors are occluded by the building anyway. */
export function createUrbanContactMask(context?: ShopfrontContext) {
  const size = context ? GRID : 1, step = 256 / size;
  const data = new Uint8Array(size * size); data.fill(255);
  const ox = context ? context.collision.origin[0] : 0, oz = context ? context.collision.origin[2] : 0;
  const origin = new Vector2(ox, oz);
  if (context) {
    // Precompute each footprint's outer ring in WORLD metres + a bbox, so a texel only tests the few
    // buildings whose expanded bbox contains it (most texels test none or one).
    const foot: { minX: number; maxX: number; minZ: number; maxZ: number; pts: Float64Array }[] = [];
    for (const building of context.collision.buildings) {
      const ring = building.rings[0]; if (!ring || ring.length < 2) continue;
      const pts = new Float64Array(ring.length * 2);
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
      for (let i = 0; i < ring.length; i++) {
        const wx = ring[i]![0] + ox, wz = ring[i]![1] + oz;
        pts[i * 2] = wx; pts[i * 2 + 1] = wz;
        if (wx < minX) minX = wx; if (wx > maxX) maxX = wx; if (wz < minZ) minZ = wz; if (wz > maxZ) maxZ = wz;
      }
      foot.push({ minX, maxX, minZ, maxZ, pts });
    }
    const R = RANGE, R2 = RANGE * RANGE;
    for (let iz = 0; iz < size; iz++) for (let ix = 0; ix < size; ix++) {
      const x = ox + (ix + 0.5) * step, z = oz + (iz + 0.5) * step;
      let best = R2;
      for (const f of foot) {
        if (x < f.minX - R || x > f.maxX + R || z < f.minZ - R || z > f.maxZ + R) continue;
        const p = f.pts, n = p.length;
        for (let i = 0; i < n; i += 2) {
          const ax = p[i]!, az = p[i + 1]!, j = (i + 2) % n, bx = p[j]!, bz = p[j + 1]!;
          const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
          const t = l2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2)) : 0;
          const ex = x - ax - dx * t, ez = z - az - dz * t, d2 = ex * ex + ez * ez;
          if (d2 < best) best = d2;
        }
        if (best === 0) break;
      }
      data[iz * size + ix] = Math.max(0, Math.min(255, Math.round((Math.sqrt(best) / R) * 255)));
    }
  }
  const texture = new DataTexture(data, size, size, RedFormat, UnsignedByteType);
  texture.name = 'building-contact AO mask';
  texture.minFilter = texture.magFilter = LinearFilter;
  texture.generateMipmaps = false; texture.needsUpdate = true;
  return { texture, origin };
}
