import { Group, type Intersection, type Raycaster } from 'three';

/** Local crowds set visibility before the scene pass; hidden actors can keep dormant transforms. */
export class VisiblePopulation extends Group {
  override updateMatrixWorld(force = false): void {
    const changed = force || this.matrixAutoUpdate || this.matrixWorldNeedsUpdate;
    super.updateWorldMatrix(false, false, force);
    if (!this.visible) return;
    for (const child of this.children) if (child.visible) child.updateMatrixWorld(changed);
  }

  override raycast(_raycaster: Raycaster, _intersects: Intersection[]): void {
    // Three's recursive picking includes hidden children. Preserve those queries even while the
    // render traversal is dormant. Explicit updateWorldMatrix/getWorldPosition also stay ordinary.
    this.updateWorldMatrix(true, true, true);
  }
}
