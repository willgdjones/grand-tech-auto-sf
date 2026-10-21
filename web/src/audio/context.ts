import { flags } from '@gtasf/shared/flags';

/** sharedAudioContext (gtasf-4f9ac): every sound module used to `new AudioContext()` lazily at its first sound (first
 *  footstep, gunshot, siren, bark...), each running its own audio render thread. With the flag on they share one context,
 *  created on the first sound. (Profiled: the FIRST creation in a page costs ~1 s of main thread in headless Chromium —
 *  that's audio-device setup and still happens once; later creations were ~1 ms.) Modules must not close or suspend it: `release` closes
 *  only a private context. (Vehicle audio, which suspends its context while you're on foot, and live voice keep their own.) */
let shared: AudioContext | undefined;

export function audioContext(): AudioContext {
  if (!flags.sharedAudioContext) return new AudioContext();
  shared ??= new AudioContext();
  return shared;
}

// Reviewer LOW (10-19): create the shared context on the player's FIRST gesture (usually an intro / identity / menu click)
// so its one-time setup (~1 s in headless at the first sound) lands there, not on the first footstep or car entry.
if (flags.sharedAudioContext && typeof window !== 'undefined') {
  const prime = () => { for (const t of ['pointerdown', 'keydown', 'touchstart'] as const) removeEventListener(t, prime, true); try { const c = audioContext(); if (c.state === 'suspended') void c.resume(); } catch { /* no audio */ } };
  for (const t of ['pointerdown', 'keydown', 'touchstart'] as const) addEventListener(t, prime, { capture: true, passive: true });
}

/** Close a module's context on dispose, unless it is the shared one (then the module disconnects its own nodes). */
export function releaseAudioContext(context: AudioContext | undefined): void {
  if (!context || context === shared) return;
  void context.close().catch(() => undefined);
}
