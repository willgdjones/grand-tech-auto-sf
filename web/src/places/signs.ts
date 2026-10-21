/**
 * In-world place signs (flag placeSigns, living map item 6): a logo + name sign at the real SF places nearest the
 * player. A small pool of camera-facing sprites (12 on HD, 5 on Low) is reassigned twice a second to the nearest
 * places within SIGN_RANGE_M; each sign is drawn once into its own 256x128 canvas from the place-logo atlas
 * (web/public/data/place-logos, built by tools/places/logos.mts; lettermark fallback). Signs stand at lobby height
 * above the place's geocoded address. Signs beyond the range are not drawn.
 */
import { CanvasTexture, SRGBColorSpace, Sprite, SpriteMaterial, type Scene } from 'three';
import { flags } from '@gtasf/shared/flags';
import { projectLocation, type MapFrame } from '../radar/projection';

export const SIGN_RANGE_M = 150;
// Towers' crown signs read from further away (they sit above the skyline).
const CROWN_RANGE_M = 600;
const SIGN_W = 9, SIGN_H = 4.5, SIGN_LIFT = 6.5;
type Place = { id: string; name: string; kind: string; x: number; z: number; y?: number; crown?: boolean };
type Atlas = { tile: number; logos: Record<string, { page: number; x: number; y: number }> };
type Slot = { sprite: Sprite; canvas: HTMLCanvasElement; texture: CanvasTexture; placeId: string };
const KIND_LABEL: Record<string, string> = { lab: 'AI LAB', bigtech: 'HQ', hackerhouse: 'HACKER HOUSE', vc: 'VC', accelerator: 'ACCELERATOR', startup: 'STARTUP' };

/** A building at least this tall gets its sign on the crown (scaled up) instead of at lobby height. */
export const TOWER_SIGN_M = 40;
export function createPlaceSigns(options: { scene: Scene; frame: MapFrame; heightAt(x: number, z: number): number | null; topAt?(x: number, z: number): number | null; low: boolean }) {
  if (!flags.placeSigns) return null;
  let places: Place[] = [], atlas: Atlas | null = null, pages: HTMLImageElement[] = [], lastPick = 0;
  const slots: Slot[] = Array.from({ length: options.low ? 5 : 12 }, () => {
    const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 128;
    const texture = new CanvasTexture(canvas); texture.colorSpace = SRGBColorSpace; texture.anisotropy = 4;
    const sprite = new Sprite(new SpriteMaterial({ map: texture, transparent: true, depthWrite: false }));
    sprite.scale.set(SIGN_W, SIGN_H, 1); sprite.visible = false; sprite.name = 'place sign'; sprite.renderOrder = 2;
    options.scene.add(sprite);
    return { sprite, canvas, texture, placeId: '' };
  });
  void Promise.all([
    fetch('/data/places.json').then(r => r.ok ? r.json() : null),
    fetch('/data/place-logos/index.json').then(r => r.ok ? r.json() : null).catch(() => null),
  ]).then(([data, index]: [{ places?: { id: string; name: string; kind: string; lat: number | null; lon: number | null }[] } | null, Atlas & { pages?: number } | null]) => {
    places = (data?.places ?? []).filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lon))
      .map(p => { const at = projectLocation(p.lat!, p.lon!, options.frame); return { id: p.id, name: p.name, kind: p.kind, x: at.x, z: at.z }; });
    atlas = index;
    pages = Array.from({ length: index?.pages ?? 0 }, (_, i) => { const img = new Image(); img.src = `/data/place-logos/page-${i}.webp`; img.onload = () => { for (const s of slots) s.placeId = ''; lastPick = 0; }; return img; });
  }).catch(() => undefined);

  function paint(slot: Slot, place: Place) {
    const c = slot.canvas.getContext('2d')!; c.clearRect(0, 0, 256, 128);
    c.fillStyle = 'rgba(12,18,20,0.88)'; c.beginPath(); c.roundRect(2, 2, 252, 124, 14); c.fill();
    c.strokeStyle = '#f0c56b'; c.lineWidth = 3; c.stroke();
    const logo = atlas?.logos[place.id], img = logo ? pages[logo.page] : undefined;
    if (logo && img?.complete && img.naturalWidth) c.drawImage(img, logo.x, logo.y, atlas!.tile, atlas!.tile, 12, 16, 96, 96);
    else { c.fillStyle = '#2b3b3a'; c.fillRect(12, 16, 96, 96); c.fillStyle = '#f4f1e8'; c.font = 'bold 56px Arial'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(place.name.slice(0, 1).toUpperCase(), 60, 66); }
    c.textAlign = 'left'; c.textBaseline = 'alphabetic';
    c.fillStyle = '#f0c56b'; c.font = 'bold 14px Arial'; c.fillText(KIND_LABEL[place.kind] ?? 'PLACE', 120, 38);
    c.fillStyle = '#f4f1e8'; let size = 28; c.font = `bold ${size}px Arial`;
    while (size > 14 && c.measureText(place.name).width > 126) { size -= 2; c.font = `bold ${size}px Arial`; }
    const words = place.name.split(' '); let line = '', y = 74;
    if (c.measureText(place.name).width <= 126) c.fillText(place.name, 120, y);
    else for (const word of words) { const next = line ? `${line} ${word}` : word; if (c.measureText(next).width > 126 && line) { c.fillText(line, 120, y); y += size + 2; line = word; } else line = next; }
    if (line && c.measureText(place.name).width > 126) c.fillText(line, 120, y);
    slot.texture.needsUpdate = true;
  }
  /** Ground (and tower crown) height once the place's chunk has loaded; false until then. */
  function resolve(place: Place): boolean {
    if (place.y !== undefined) return true;
    const ground = options.heightAt(place.x, place.z); if (ground === null) return false;
    const top = options.topAt?.(place.x, place.z) ?? null;
    place.crown = top !== null && top - ground >= TOWER_SIGN_M;
    // Geocoded points often fall inside the building: a low-rise sign stands on its roof when that is above lobby height.
    place.y = place.crown ? top! + 3 : Math.max(ground + SIGN_LIFT, top !== null ? top + 1 + SIGN_H / 2 : -Infinity) - SIGN_LIFT;
    return true;
  }
  return {
    update(at: { x: number; z: number }, now = performance.now()) {
      if (!places.length || now - lastPick < 500) return;
      lastPick = now;
      const near = places.map(p => ({ p, d: Math.hypot(p.x - at.x, p.z - at.z) })).filter(v => v.d <= CROWN_RANGE_M && resolve(v.p) && v.d <= (v.p.crown ? CROWN_RANGE_M : SIGN_RANGE_M))
        .sort((a, b) => a.d - b.d).slice(0, slots.length).map(v => v.p);
      const keep = new Set(near.map(p => p.id));
      const free = slots.filter(s => !keep.has(s.placeId));
      for (const place of near) {
        let slot = slots.find(s => s.placeId === place.id);
        if (!slot) { slot = free.shift(); if (!slot) continue; slot.placeId = place.id; paint(slot, place); }
        const k = place.crown ? 3 : 1; slot.sprite.scale.set(SIGN_W * k, SIGN_H * k, 1);
        slot.sprite.position.set(place.x, (place.y ?? 0) + (place.crown ? SIGN_H * k / 2 : SIGN_LIFT), place.z); slot.sprite.visible = true;
      }
      for (const s of free) { s.sprite.visible = false; s.placeId = ''; }
    },
    /** Testing harness: the signs currently shown (place id, height, scale). */
    get shown() { return slots.filter(s => s.sprite.visible).map(s => ({ id: s.placeId, x: Math.round(s.sprite.position.x), y: Math.round(s.sprite.position.y), z: Math.round(s.sprite.position.z), parent: s.sprite.parent?.type ?? null, opacity: s.sprite.material.opacity, tex: s.canvas.width })); },
    dispose() { for (const s of slots) { s.sprite.removeFromParent(); s.texture.dispose(); s.sprite.material.dispose(); } },
  };
}
