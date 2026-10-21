import { LOD, Vector3, type Camera, type Intersection, type Raycaster } from 'three';

/** Low vehicles keep hidden detail trees dormant, then refresh them before they become visible. */
const nearCamera = new Vector3(), nearSelf = new Vector3();
/** carNearDetail: only ONE car shows its HD near level at a time (the nearest, with a little hysteresis). */
let nearWinner: { lod: VisibleLod; d: number; at: number } | undefined;
// 9 m from the CAMERA: the phone chase boom sits ~5-6 m behind the player, so a kerb car beside the player at spawn was ~6-7 m
// out and stayed the crumpled Low LOD in the first minute (critic #6.25 N5). Still one HD car at a time.
const NEAR_SHOW_M = 9;
/** carNearDetail: the player's ground position (set each frame by main.ts). The phone chase boom sits ~5-6 m behind the player,
 * so a car right beside the player is ~9-10 m from the camera; ranking by the player too lets that car win (critic N5,
 * prod #6.28: a fleet prius 4.9 m from the player stayed on its crushed low level). */
const nearFocus = { x: 0, z: 0, set: false };
const FOCUS_SHOW_M = 6, WINNER_HOLD_M = 40;
export function setNearDetailFocus(x: number, z: number): void { nearFocus.x = x; nearFocus.z = z; nearFocus.set = true; }
export class VisibleLod extends LOD {
  /** carNearDetail: called once the first time the camera comes within nearRequestM (lazy HD near level). */
  onNear?: () => void;
  nearRequestM = 0;
  /** carNearDetail: the low level that hands over to the HD level for the single nearest car. */
  nearLowLevel?: { distance: number };

  override updateMatrixWorld(force = false): void {
    const changed = force || this.matrixAutoUpdate || this.matrixWorldNeedsUpdate;
    super.updateWorldMatrix(false, false, force);
    for (const child of this.children) if (child.visible) child.updateMatrixWorld(changed);
  }

  override update(camera: Camera): void {
    if (this.onNear || this.nearLowLevel) {
      const self = this.getWorldPosition(nearSelf), cam = camera.getWorldPosition(nearCamera).distanceTo(self), now = performance.now();
      // Score: camera distance, or (scaled into the same ring) the distance from the player when that's closer.
      const focus = nearFocus.set ? Math.hypot(self.x - nearFocus.x, self.z - nearFocus.z) * (NEAR_SHOW_M / FOCUS_SHOW_M) : Infinity;
      const d = Math.min(cam, focus);
      if (this.onNear && Math.min(cam, focus) < this.nearRequestM) { const request = this.onNear; this.onNear = undefined; request(); }
      if (this.nearLowLevel) {
        const winner = nearWinner;
        if (winner?.lod === this) { winner.d = d; winner.at = now; if (d > NEAR_SHOW_M + 1) nearWinner = undefined; }
        else if (d < NEAR_SHOW_M && (!winner || now - winner.at > 250 || d < winner.d - .5)) nearWinner = { lod: this, d, at: now };
        // The winner keeps its HD level out to WINNER_HOLD_M of camera distance (it may win by player distance while the camera
        // is ~10 m back); non-winners: the low level always wins.
        this.nearLowLevel.distance = nearWinner?.lod === this ? WINNER_HOLD_M : 0;
      }
    }
    const previous = this.levels[this.getCurrentLevel()]?.object;
    const wasVisible = previous?.visible;
    super.update(camera);
    const current = this.levels[this.getCurrentLevel()]?.object;
    // Three selects the LOD after its scene matrix pass. A newly revealed level must use this
    // frame's vehicle/wheel transforms, including when a caller hid the previous active level.
    if (current && (current !== previous || !wasVisible)) current.updateMatrixWorld(true);
  }

  override raycast(raycaster: Raycaster, intersects: Intersection[]): void {
    // Recursive raycasts can inspect any level, including a hidden one. Refresh on this infrequent
    // query so toy impacts and other picks retain the same geometry as the ordinary Three LOD.
    this.updateWorldMatrix(true, true, true);
    super.raycast(raycaster, intersects);
  }
}
