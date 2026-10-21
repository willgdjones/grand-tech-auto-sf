/**
 * Photo-card trees for landmarks (flag landmarkCardTrees; docs/critique/2026-10-15-gta-v-gap.md #19).
 *
 * The street trees are already crossed alpha cards from the sf-trees atlas, but the authored landmarks (the Ferry
 * plaza's tree pits, the six Embarcadero palms, SF General's yard) still built their trees from icosahedron blobs and
 * nine flat fronds in the vertex-coloured Parts mesh: the loudest low-poly tell in the spawn frame. This draws those
 * same trees as two crossed cards cut from the atlas (HD) or the legacy per-kind PNGs (Low, which the street props
 * already fetch), so a landmark tree looks like the street tree beside it. One merged mesh per kind per landmark,
 * no instancing or per-frame work; the mesh stays hidden until its texture has loaded.
 */
import { DoubleSide, Group, ImageLoader, Mesh, MeshLambertMaterial, PlaneGeometry, SRGBColorSpace, Texture } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import treeAtlas from '../../../public/art/foliage/sf-trees.json';
import { graphicsPreset } from '../graphicsPreset';
import { smoothFoliageTexture } from '../props/streetProps';

export type CardTreeKind = 'palm' | 'plane' | 'cypress' | 'eucalyptus' | 'pine' | 'ficus';
export interface CardTree {
  kind: CardTreeKind;
  /** Trunk base in the landmark's local metres. */
  x: number; y: number; z: number;
  /** Overall height (m); the card keeps the atlas cell's aspect. Defaults to the cell's authored height. */
  height?: number;
  /** Yaw of the first card (rad); the second is at +90°. Vary per tree so a row doesn't share one silhouette. */
  yaw?: number;
}

interface Cell { id: string; rect: readonly [number, number, number, number]; widthMetres: number; heightMetres: number }
const CELLS = new Map<string, Cell>(treeAtlas.cells.map(cell => [cell.id, cell as unknown as Cell]));
/** Low has no atlas: reuse the legacy per-kind PNGs the street props load on that tier (full-UV cards). */
const LEGACY: Record<CardTreeKind, 'palm' | 'plane' | 'cypress'> = { palm: 'palm', plane: 'plane', ficus: 'plane', eucalyptus: 'plane', cypress: 'cypress', pine: 'cypress' };

const textures = new Map<string, Promise<Texture>>();
function loadTexture(url: string): Promise<Texture> {
  let pending = textures.get(url);
  if (!pending) {
    pending = new ImageLoader().loadAsync(url).then(image => {
      const texture = new Texture(image); texture.colorSpace = SRGBColorSpace; texture.needsUpdate = true; texture.name = `card trees ${url}`;
      smoothFoliageTexture(texture);
      return texture;
    });
    textures.set(url, pending);
  }
  return pending;
}

/** Two crossed cards for one tree, in local metres, with UVs cut to the atlas cell (or the full legacy image). */
function cardGeometry(tree: CardTree, cell: Cell, atlas: boolean) {
  const scale = tree.height ? tree.height / cell.heightMetres : 1;
  const width = cell.widthMetres * scale, height = cell.heightMetres * scale, yaw = tree.yaw ?? 0;
  const cards = [0, Math.PI / 2].map(turn => {
    const geometry = new PlaneGeometry(width, height).translate(0, height / 2, 0).rotateY(yaw + turn).translate(tree.x, tree.y, tree.z);
    if (atlas) {
      const [rx, ry, rw, rh] = cell.rect, { width: W, height: H } = treeAtlas;
      const uv = geometry.getAttribute('uv');
      for (let i = 0; i < uv.count; i++) {
        // PlaneGeometry v=1 is the top edge; the atlas rect is measured from the image's top-left (flipY texture).
        uv.setXY(i, (rx + uv.getX(i) * rw) / W, (H - ry - rh + uv.getY(i) * rh) / H);
      }
      uv.needsUpdate = true;
    }
    return geometry;
  });
  const merged = mergeGeometries(cards, false)!;
  for (const card of cards) card.dispose();
  return merged;
}

/**
 * Build the card trees for one landmark as a Group (local coordinates; add it to the landmark's root). Returns an
 * empty group when there is nothing to draw. Textures load asynchronously; disposal via the landmark's usual
 * `disposeLandmark` traversal (geometry + material), textures are shared and kept.
 */
export function createCardTrees(trees: readonly CardTree[], name: string): Group {
  const group = new Group(); group.name = name;
  if (!trees.length) return group;
  const atlas = graphicsPreset() === 'hd';
  const byKind = new Map<CardTreeKind, CardTree[]>();
  for (const tree of trees) { const list = byKind.get(tree.kind) ?? []; list.push(tree); byKind.set(tree.kind, list); }
  for (const [kind, list] of byKind) {
    const cell = CELLS.get(kind) ?? CELLS.get('plane')!;
    const pieces = list.map(tree => cardGeometry(tree, cell, atlas));
    const geometry = mergeGeometries(pieces, false)!;
    for (const piece of pieces) piece.dispose();
    geometry.computeBoundingBox(); geometry.computeBoundingSphere();
    const material = new MeshLambertMaterial({ alphaTest: 0.5, side: DoubleSide, visible: false });
    material.name = `Landmark card trees (${kind})`;
    const mesh = new Mesh(geometry, material); mesh.name = `${name} ${kind} cards`;
    mesh.castShadow = false; mesh.receiveShadow = false;
    group.add(mesh);
    const url = atlas ? treeAtlas.atlas : `/art/foliage/${LEGACY[kind]}.png`;
    void loadTexture(url).then(texture => { material.map = texture; material.visible = true; material.needsUpdate = true; })
      .catch(() => { /* no texture: the landmark simply has no card trees (never a bare quad) */ });
  }
  return group;
}
