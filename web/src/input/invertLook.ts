/**
 * "Invert look" preference (founder 2026-10-13): the default is non-inverted (up looks up); this per-device
 * toggle flips the vertical look for players who prefer inverted. Persisted in localStorage, read live by the
 * camera (ThirdPersonCamera's invertY option) and toggled from Game Options. Best-effort storage, like the
 * founder-ladder bucket.
 */
const KEY = 'gtasf.invertLook.v1';

export function isInvertLook(): boolean {
  try { return localStorage.getItem(KEY) === 'on'; } catch { return false; }
}

export function setInvertLook(on: boolean): void {
  try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch { /* per-session best effort */ }
}
