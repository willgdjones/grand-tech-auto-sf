import { expect, it, vi } from 'vitest';
// gtasf-3k35 part a: exercise the incremental (fastStructureCollision) bucketing path and prove it
// produces the SAME collision results as the full-rebuild path, including when one chunk is removed while
// others remain. flags is read only for fastStructureCollision here, so a minimal override is safe.
vi.mock('@gtasf/shared/flags', () => ({ flags: { fastStructureCollision: true } }));
const { StructureCollisionIndex } = await import('./structureCollision');
const { BufferAttribute, BufferGeometry, Group, Mesh, MeshBasicMaterial } = await import('three');

/** A vertical building wall quad (two triangles) at a given x-range and z. */
function wall(root: InstanceType<typeof Group>, x0: number, x1: number, z: number): { geometry: InstanceType<typeof BufferGeometry>; material: InstanceType<typeof MeshBasicMaterial> } {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(Float32Array.from([
    x0, 0, z, x1, 0, z, x1, 8, z, x0, 0, z, x1, 8, z, x0, 8, z,
  ]), 3));
  const material = new MeshBasicMaterial(), mesh = new Mesh(geometry, material); mesh.name = 'buildings'; root.add(mesh);
  return { geometry, material };
}

it('incremental bucketing matches full-rebuild collision results across multi-chunk add/remove', () => {
  const index = new StructureCollisionIndex();
  const rootA = new Group(), a = wall(rootA, 10, 14, 5);
  const rootB = new Group(), b = wall(rootB, 110, 114, 205); // a separate, distant chunk's wall
  index.setChunk('a', rootA, /^buildings(?:_|$)/);
  index.setChunk('b', rootB, /^buildings(?:_|$)/);
  expect(index.stats.triangles).toBe(4);
  // Both walls collide; clear air between/around them does not.
  expect(index.collides(12, 1, 5, .5, 1.8)).toBe(true);
  expect(index.collides(112, 1, 205, .5, 1.8)).toBe(true);
  expect(index.collides(12, 1, 9, .5, 1.8)).toBe(false);
  expect(index.collides(112, 1, 209, .5, 1.8)).toBe(false);
  // Removing chunk A must not disturb chunk B (the point of per-chunk unbucketing).
  index.removeChunk('a');
  expect(index.stats.triangles).toBe(2);
  expect(index.collides(12, 1, 5, .5, 1.8)).toBe(false); // A's wall gone
  expect(index.collides(112, 1, 205, .5, 1.8)).toBe(true); // B's wall intact
  // Re-adding A restores it; clear() empties everything.
  index.setChunk('a', rootA, /^buildings(?:_|$)/);
  expect(index.collides(12, 1, 5, .5, 1.8)).toBe(true);
  index.clear();
  expect(index.stats.cells).toBe(0);
  expect(index.collides(12, 1, 5, .5, 1.8)).toBe(false);
  expect(index.collides(112, 1, 205, .5, 1.8)).toBe(false);
  a.geometry.dispose(); a.material.dispose(); b.geometry.dispose(); b.material.dispose();
});

it('re-setting a chunk replaces its faces (no stale duplicates) incrementally', () => {
  const index = new StructureCollisionIndex();
  const root1 = new Group(), w1 = wall(root1, 10, 14, 5);
  index.setChunk('c', root1, /^buildings(?:_|$)/);
  expect(index.collides(12, 1, 5, .5, 1.8)).toBe(true);
  // Replace the chunk's geometry with a wall at a different place; the old one must disappear.
  const root2 = new Group(), w2 = wall(root2, 10, 14, 25);
  index.setChunk('c', root2, /^buildings(?:_|$)/);
  expect(index.stats.triangles).toBe(2); // not 4 — previous faces were unbucketed
  expect(index.collides(12, 1, 5, .5, 1.8)).toBe(false); // old wall gone
  expect(index.collides(12, 1, 25, .5, 1.8)).toBe(true); // new wall present
  w1.geometry.dispose(); w1.material.dispose(); w2.geometry.dispose(); w2.material.dispose();
});
