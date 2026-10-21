import {
  BufferGeometry, Float32BufferAttribute, LinearFilter, Mesh, MeshLambertMaterial,
  NearestFilter, SRGBColorSpace, Texture, type Object3D,
} from 'three';
import { FootprintIndex, sampleHeight, type ChunkCollision, type Heightfield } from './chunks/terrain';

const NAMES = ['pivot-coffee', 'fog-city', 'stealth', 'runway-repairs'] as const;
interface SignManifest {
  version: 1; path: string; width: number; height: number; sha256: string;
  assets: { id: string; pixelRect: [number, number, number, number] }[];
}
export interface ShopfrontContext {
  collision: ChunkCollision;
  ground: Heightfield;
  nearestRoad(x: number, z: number, maxDistance?: number): { x: number; y: number; z: number; yaw: number } | null;
}
type Placement = { id: string; style: number; centre: [number, number, number]; normal: [number, number]; width: number; height: number };
function hash(text: string): number { let value = 2166136261; for (const character of text) value = Math.imul(value ^ character.charCodeAt(0), 16777619); return value >>> 0; }

/** One complete, correctly oriented label per selected street-facing footprint; no per-frame scans. */
export function placeShopfrontSigns({ collision, ground, nearestRoad }: ShopfrontContext): Placement[] {
  const result: Placement[] = [];
  const blockers = new FootprintIndex(); blockers.rebuild([collision]);
  const [originX, , originZ] = collision.origin;
  for (const building of [...collision.buildings].sort((a, b) => hash(a.id) - hash(b.id))) {
    // The authored Ferry Building and tiny outbuildings do not receive generic shop signs.
    if (building.id.startsWith('datasf:201006.0000058:') || building.maxY - building.minY < 5 || hash(building.id) % 3 !== 0) continue;
    const ring = building.rings[0]; if (!ring || ring.length < 3) continue;
    let area = 0;
    for (let i = 0; i < ring.length; i++) { const a = ring[i]!, b = ring[(i + 1) % ring.length]!; area += a[0] * b[1] - b[0] * a[1]; }
    let candidate: { x: number; z: number; nx: number; nz: number; width: number; roadY: number } | undefined, best = Infinity;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i]!, b = ring[(i + 1) % ring.length]!, dx = b[0] - a[0], dz = b[1] - a[1], length = Math.hypot(dx, dz);
      if (length < 6) continue;
      const nx = dz / length * Math.sign(area), nz = -dx / length * Math.sign(area);
      const x = originX + (a[0] + b[0]) / 2, z = originZ + (a[1] + b[1]) / 2;
      const road = nearestRoad(x + nx, z + nz, 22); if (!road) continue;
      const rx = road.x - x, rz = road.z - z, distance = Math.hypot(rx, rz);
      if (distance < 2 || distance > 22 || (nx * rx + nz * rz) / distance < .7) continue;
      if (blockers.collides(x + nx * .5, road.y + 2, z + nz * .5, .1, 1)) continue;
      if (distance < best) {
        best = distance;
        candidate = { x, z, nx, nz, width: Math.min(4.8, length - 1.5), roadY: road.y };
      }
    }
    if (!candidate) continue;
    const { x, z, nx, nz, width, roadY } = candidate;
    // Pick the same canonical wall before the cell test: duplicated footprints cannot duplicate signs.
    if (Math.floor(x / 256) !== ground.x || Math.floor(z / 256) !== ground.z) continue;
    const y = sampleHeight(ground, x + nx * .15, z + nz * .15);
    if (y === null || Math.abs(y - roadY) > 3 || y + 4 > building.maxY || y + 2 < building.minY) continue;
    const ends = [-1, 1].map(sign => sampleHeight(ground, x + nx * .15 + nz * width / 2 * sign, z + nz * .15 - nx * width / 2 * sign));
    if (ends.some(end => end === null || Math.abs(end - y) > 1)) continue;
    result.push({ id: building.id, style: hash(building.id + ':sign') % NAMES.length,
      centre: [x + nx * .28, y + 3, z + nz * .28], normal: [nx, nz], width, height: width / 4.2 });
    if (result.length === 18) break;
  }
  return result;
}

function inspect(value: unknown): SignManifest {
  const data = value as SignManifest;
  if (data?.version !== 1 || !/^\/art\/props\/[a-z0-9-]+\.png$/.test(data.path)
    || !Number.isInteger(data.width) || !Number.isInteger(data.height) || data.width < 1 || data.height < 1
    || data.width * data.height > 1_048_576 || !/^[a-f0-9]{64}$/.test(data.sha256) || !Array.isArray(data.assets)) throw new Error('Invalid shopfront manifest');
  for (const name of NAMES) {
    const entries = data.assets.filter(entry => entry.id === name), rect = entries[0]?.pixelRect;
    if (entries.length !== 1 || !rect || rect.length !== 4 || !rect.every(Number.isInteger)
      || rect[0] < 0 || rect[1] < 0 || rect[2] < 1 || rect[3] < 1
      || rect[0] + rect[2] > data.width || rect[1] + rect[3] > data.height) throw new Error(`Invalid sign row ${name}`);
  }
  return data;
}

/** Scene owns the image/material; each chunk owns only its merged sign geometry. */
export function createShopfrontSigns() {
  const abort = new AbortController();
  const material = new MeshLambertMaterial({ name: 'GTASF shopfront signs', color: 'white', fog: true, flatShading: true });
  // The atlas supplies the sign lettering; its dark background stays dark at night.
  material.emissive.set('#b8fff3'); material.emissiveIntensity = 0;
  const stats = { state: 'loading', error: '', bytes: 0, width: 0, height: 0, signs: 0, batches: 0 };
  let disposed = false, bitmap: ImageBitmap | undefined, texture: Texture | undefined, manifest: SignManifest | undefined;
  const releases = new Set<() => void>();
  const mountedBuildings = new Set<string>();
  const ready = (async () => {
    if (typeof window === 'undefined') { stats.state = 'disabled'; return false; }
    try {
      const response = await fetch('/art/props/signs-manifest.json', { signal: abort.signal });
      if (!response.ok) throw new Error(`Shopfront manifest HTTP ${response.status}`);
      const data = inspect(await response.json());
      const image = await fetch(data.path, { signal: abort.signal });
      if (!image.ok) throw new Error(`Shopfront atlas HTTP ${image.status}`);
      const bytes = await image.arrayBuffer();
      if (bytes.byteLength > 4_000_000) throw new Error('Shopfront encoded budget exceeded');
      const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(n => n.toString(16).padStart(2, '0')).join('');
      if (digest !== data.sha256) throw new Error('Shopfront atlas hash mismatch');
      const decoded = await createImageBitmap(new Blob([bytes], { type: 'image/png' }), { imageOrientation: 'flipY', colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
      if (disposed) { decoded.close(); return false; }
      if (decoded.width !== data.width || decoded.height !== data.height) { decoded.close(); throw new Error('Shopfront dimensions differ from manifest'); }
      bitmap = decoded; manifest = data; texture = new Texture(bitmap); texture.colorSpace = SRGBColorSpace;
      texture.flipY = false; texture.minFilter = LinearFilter; texture.magFilter = NearestFilter; texture.generateMipmaps = false; texture.needsUpdate = true;
      material.map = texture; material.emissiveMap = texture; material.needsUpdate = true;
      Object.assign(stats, { state: 'ready', bytes: bytes.byteLength, width: data.width, height: data.height });
      return true;
    } catch (error) { if (!disposed) { stats.state = 'unavailable'; stats.error = String(error); } return false; }
  })();
  function mount(root: Object3D): () => void {
    const context = root.userData.gtasfShopfrontContext as ShopfrontContext | undefined;
    if (!context) return () => {};
    let active = true, mesh: Mesh | undefined, count = 0, ids: string[] = [];
    const release = () => {
      if (!active) return;
      active = false;
      if (mesh) { root.remove(mesh); mesh.geometry.dispose(); stats.signs -= count; stats.batches--; }
      for (const id of ids) mountedBuildings.delete(id);
      releases.delete(release);
    };
    releases.add(release);
    void ready.then(loaded => {
      if (!loaded || !active || disposed || !manifest) return;
      const placements = placeShopfrontSigns(context).filter(sign => !mountedBuildings.has(sign.id));
      if (!placements.length) return;
      ids = placements.map(sign => sign.id); for (const id of ids) mountedBuildings.add(id);
      const vertices: number[] = [], normals: number[] = [], uvs: number[] = [];
      for (const sign of placements) {
        const rect = manifest.assets.find(entry => entry.id === NAMES[sign.style])!.pixelRect;
        const u0 = (rect[0] + .5) / manifest.width, u1 = (rect[0] + rect[2] - .5) / manifest.width;
        const v0 = 1 - (rect[1] + rect[3] - .5) / manifest.height, v1 = 1 - (rect[1] + .5) / manifest.height;
        const [nx, nz] = sign.normal, [x, y, z] = sign.centre;
        for (const [right, up, u, v] of [[-1,-1,u0,v0],[1,-1,u1,v0],[1,1,u1,v1],[-1,-1,u0,v0],[1,1,u1,v1],[-1,1,u0,v1]]) {
          vertices.push(x + nz * sign.width / 2 * right! - root.position.x, y + sign.height / 2 * up! - root.position.y, z - nx * sign.width / 2 * right! - root.position.z);
          normals.push(nx, 0, nz); uvs.push(u!, v!);
        }
      }
      const geometry = new BufferGeometry();
      geometry.setAttribute('position', new Float32BufferAttribute(vertices, 3));
      geometry.setAttribute('normal', new Float32BufferAttribute(normals, 3));
      geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2)); geometry.computeBoundingSphere();
      mesh = new Mesh(geometry, material); mesh.name = 'Shopfront signs';
      mesh.userData.gtasfShopfrontSigns = placements; mesh.userData.gtasfBillboard = true;
      root.add(mesh); count = placements.length; stats.signs += count; stats.batches++;
    });
    return release;
  }
  return { stats, ready, mount,
    setNight(value: number) { material.emissiveIntensity = Math.max(0,Math.min(1,value))*1.5; },
    dispose() {
      if (disposed) return;
      disposed = true; abort.abort(); for (const release of releases) release();
      stats.state = 'disposed'; material.dispose(); texture?.dispose(); bitmap?.close();
      texture = undefined; bitmap = undefined;
    },
  };
}
