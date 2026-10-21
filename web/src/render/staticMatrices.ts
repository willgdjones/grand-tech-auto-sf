import type { Object3D } from 'three';

/**
 * chunkWorldFreeze (gtasf perf): streamed chunk subtrees (buildings/roads/ground) never move after placement —
 * LOD/facade levels only toggle child *visibility*, never transforms. three.js still walks every node of every
 * mounted chunk each frame in `updateMatrixWorld` (the recursion is unconditional; `matrixWorldAutoUpdate=false`
 * skips a node's compose but NOT the traversal visit — the larger cost in the phone-Low steady frame, where
 * `updateMatrixWorld` self-time dominates `multiplyMatrices`). This composes the whole subtree's world matrices
 * once, then replaces the root's `updateMatrixWorld` with a no-op so the per-frame scene cascade prunes the entire
 * static subtree. Only call on subtrees with NO moving descendants (pure streamed geometry).
 */
const NOOP = function (this: Object3D) { /* subtree is static: nothing to recompute per frame */ };

export function freezeStaticWorld(root: Object3D): void {
  root.updateMatrixWorld(true);            // one-time full local+world compose for the whole subtree
  root.matrixAutoUpdate = false;           // never recompose the local matrix
  root.matrixWorldAutoUpdate = false;      // never recompose this node's world matrix
  (root as Object3D & { updateMatrixWorld: () => void }).updateMatrixWorld = NOOP; // prune the subtree traversal
}
