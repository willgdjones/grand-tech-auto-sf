import { Raycaster, Vector2, type Camera, type Object3D } from 'three';
import { flags } from '@gtasf/shared/flags';
import type { RadarEvent } from '../radar/radar';

export interface EventLinkTarget { object: Object3D; event: RadarEvent; kind: 'label' | 'ring' }
export function publicEventUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !/^https?:\/\//i.test(value.trim())) return null;
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) && url.hostname ? url.href : null; }
  catch { return null; }
}
function visible(object: Object3D): boolean {
  if (!object.parent) return false;
  for (let current: Object3D | null = object; current; current = current.parent) if (!current.visible) return false;
  return true;
}
/** Sprites win over ground rings, matching what the player sees in front of the city. */
export function pickEventLink(camera: Camera, point: Vector2, targets: readonly EventLinkTarget[], ray = new Raycaster()): EventLinkTarget | null {
  camera.updateMatrixWorld(); ray.setFromCamera(point, camera);
  let best: EventLinkTarget | null = null, distance = Infinity;
  for (const target of targets) {
    if (!visible(target.object) || !publicEventUrl(target.event.url)) continue;
    target.object.updateWorldMatrix(true, false);
    const hit = ray.intersectObject(target.object, false)[0];
    if (!hit) continue;
    if (!best || (target.kind === 'label' && best.kind === 'ring') || (target.kind === best.kind && hit.distance < distance)) {
      best = target; distance = hit.distance;
    }
  }
  return best;
}

export function bindWorldEventLinks(options: {
  canvas: HTMLCanvasElement; camera: Camera; targets(): readonly EventLinkTarget[];
  canInteract(): boolean; hover(id: string | null): void;
}) {
  if (!flags.worldEventLinks) return null;
  const { canvas } = options, doc = canvas.ownerDocument, win = doc.defaultView!;
  const ray = new Raycaster(), point = new Vector2();
  const hint = doc.createElement('div'); hint.textContent = 'Click to open ↗'; hint.hidden = true;
  hint.style.cssText = 'position:fixed;z-index:58;pointer-events:none;color:#fff5be;background:#111d;padding:4px 7px;font:700 12px Arial;text-shadow:1px 1px #000;border:1px solid #f0b429';
  doc.body.append(hint);
  const previousCursor = canvas.style.cursor;
  let pointer: { id: number; x: number; y: number; moved: number } | null = null;
  let x = 0, y = 0, over = false, suppressClick = false, lastHover = -Infinity;
  function hit() {
    if (!options.canInteract()) return null;
    const rect = canvas.getBoundingClientRect(), locked = doc.pointerLockElement === canvas;
    if (!rect.width || !rect.height || (!locked && (!over || x < rect.left || x > rect.right || y < rect.top || y > rect.bottom))) return null;
    point.set(locked ? 0 : (x - rect.left) / rect.width * 2 - 1, locked ? 0 : 1 - (y - rect.top) / rect.height * 2);
    return pickEventLink(options.camera, point, options.targets(), ray);
  }
  function update(now: number) {
    if (now - lastHover < 100) return; lastHover = now;
    const target = hit(), locked = doc.pointerLockElement === canvas;
    canvas.style.cursor = target && !locked ? 'pointer' : previousCursor;
    options.hover(target?.event.id ?? null); hint.hidden = !target;
    if (target) {
      const rect = canvas.getBoundingClientRect();
      hint.style.left = `${Math.min(win.innerWidth - 132, Math.max(4, locked ? rect.left + rect.width / 2 + 14 : x + 14))}px`;
      hint.style.top = `${Math.min(win.innerHeight - 30, locked ? rect.top + rect.height / 2 + 18 : y + 20)}px`;
    }
  }
  function down(event: PointerEvent) {
    if (event.pointerType === 'touch' && !event.isPrimary) { pointer = null; return; }
    if (event.button !== 0 || !event.isPrimary) return;
    suppressClick = false; x = event.clientX; y = event.clientY; over = true;
    pointer = { id: event.pointerId, x, y, moved: 0 };
  }
  function move(event: PointerEvent) {
    x = event.clientX; y = event.clientY;
    if (pointer?.id === event.pointerId) pointer.moved += Math.abs(event.movementX) + Math.abs(event.movementY);
  }
  function up(event: PointerEvent) {
    const start = pointer; if (!start || start.id !== event.pointerId) return;
    pointer = null; x = event.clientX; y = event.clientY;
    if (Math.hypot(x - start.x, y - start.y) > 6 || start.moved > 8) return;
    const target = hit(), url = publicEventUrl(target?.event.url);
    if (!url) return;
    // Synchronous pointerup is a real user gesture, including touch and pointer-locked clicks.
    // Do not await lock release: doing so can lose the popup permission.
    if (doc.pointerLockElement === canvas) doc.exitPointerLock();
    win.open(url, '_blank', 'noopener,noreferrer');
    suppressClick = true; hint.hidden = true; options.hover(null);
  }
  function click(event: MouseEvent) {
    if (!suppressClick) return; suppressClick = false;
    event.preventDefault(); event.stopImmediatePropagation(); // Don't reacquire look-lock after opening.
  }
  function leave() { over = false; }
  function enter() { over = true; }
  function cancel() { pointer = null; }
  canvas.addEventListener('pointerdown', down, true); canvas.addEventListener('pointermove', move);
  canvas.addEventListener('pointerenter', enter);
  canvas.addEventListener('pointerleave', leave); canvas.addEventListener('click', click, true);
  win.addEventListener('pointerup', up, true); win.addEventListener('pointercancel', cancel);
  return { update, destroy() {
    canvas.removeEventListener('pointerdown', down, true); canvas.removeEventListener('pointermove', move);
    canvas.removeEventListener('pointerenter', enter);
    canvas.removeEventListener('pointerleave', leave); canvas.removeEventListener('click', click, true);
    win.removeEventListener('pointerup', up, true); win.removeEventListener('pointercancel', cancel);
    canvas.style.cursor = previousCursor; options.hover(null); hint.remove();
  } };
}
