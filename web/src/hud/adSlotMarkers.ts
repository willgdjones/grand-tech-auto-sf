import { Vector3, type Camera } from 'three';
import { flags } from '@gtasf/shared/flags';
import './adSlotMarkers.css';

/**
 * Clickable "Buy this billboard" badges floating on nearby billboards (gtasf-buy-ad-slot-page-yxua).
 * Consumes the parody-billboard renderer's `stats.placed` (world centres of the currently-visible
 * boards), projects the nearest few to screen like the chat/nameplate overlays, and calls `onSelect`
 * with the slot id on click → the gated slot page. No game loop of its own; `update` is ticked per
 * frame. Returns null when flagged off.
 */
export interface PlacedBillboard { id: string; x: number; y: number; z: number; }

const MAX_BADGES = 6;        // Only the nearest few, so the city isn't littered with pills.
const MAX_DISTANCE_M = 170;  // Close enough that you could drive/walk up to it.
const TOP_OFFSET_M = 3.2;    // Lift the badge just above the board.

export function createAdSlotMarkers(options: { parent?: HTMLElement; onSelect(id: string): void }) {
  if (!flags.adSlots) return null;
  const layer = document.createElement('div');
  layer.className = 'gt-adslot-markers'; layer.setAttribute('aria-hidden', 'true');
  (options.parent ?? document.body).append(layer);

  const badges = new Map<string, HTMLButtonElement>();
  const keep = new Set<string>();
  const stale: string[] = [];
  const point = new Vector3();
  let disposed = false;

  function ensure(id: string): HTMLButtonElement {
    let badge = badges.get(id);
    if (badge) return badge;
    badge = document.createElement('button');
    badge.type = 'button'; badge.className = 'gt-adslot-badge'; badge.tabIndex = -1;
    badge.textContent = 'Buy this billboard';
    badge.addEventListener('click', () => { if (!disposed) options.onSelect(id); });
    layer.append(badge); badges.set(id, badge);
    return badge;
  }
  function remove(id: string) { badges.get(id)?.remove(); badges.delete(id); }

  function update(camera: Camera, focus: { x: number; z: number }, placed: readonly PlacedBillboard[]) {
    if (disposed) return;
    keep.clear();
    const nearest = placed
      .filter(p => (p.x - focus.x) ** 2 + (p.z - focus.z) ** 2 < MAX_DISTANCE_M * MAX_DISTANCE_M)
      .sort((a, b) => (a.x - focus.x) ** 2 + (a.z - focus.z) ** 2 - ((b.x - focus.x) ** 2 + (b.z - focus.z) ** 2))
      .slice(0, MAX_BADGES);
    for (const board of nearest) {
      keep.add(board.id);
      const badge = ensure(board.id);
      point.set(board.x, board.y + TOP_OFFSET_M, board.z).project(camera);
      const offscreen = point.z < -1 || point.z > 1 || Math.abs(point.x) > 1 || Math.abs(point.y) > 1;
      badge.hidden = offscreen;
      if (offscreen) continue;
      badge.style.left = `${(point.x * .5 + .5) * innerWidth}px`;
      badge.style.top = `${(-point.y * .5 + .5) * innerHeight}px`;
    }
    stale.length = 0;
    for (const id of badges.keys()) if (!keep.has(id)) stale.push(id);
    for (const id of stale) remove(id);
  }

  return {
    element: layer,
    update,
    destroy() { if (disposed) return; disposed = true; for (const id of [...badges.keys()]) remove(id); layer.remove(); },
  };
}
