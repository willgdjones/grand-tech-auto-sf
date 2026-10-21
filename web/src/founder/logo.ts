/**
 * Generated lettermark logo for a startup name (PLAN step 3: "the startup name + a generated
 * lettermark logo appear on it"). Pure derivation of initials + a deterministic colour pair from the
 * name, so the found-your-startup card (DOM badge) and the billboard (canvas texture) draw the same
 * mark. No DOM here — renderers live beside their consumers.
 */

/** FNV-1a over the name so the same startup always gets the same mark across the card and billboard. */
function hash(seed: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619) >>> 0;
  return h >>> 0;
}

export interface Lettermark {
  /** 1–2 uppercase initials. */
  readonly initials: string;
  /** Badge background hue (deterministic from the name). */
  readonly bg: string;
  /** Readable foreground (always light, badges are saturated). */
  readonly fg: string;
}

/** Initials: first letters of the first two words, or the first two letters of a single word. */
export function startupInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '★';
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return (words[0]![0]! + words[1]![0]!).toUpperCase();
}

/** A saturated SF-palette badge colour derived from the name, with a light foreground. */
export function lettermark(name: string): Lettermark {
  const h = hash(name);
  // A spread of confident SF-startup hues; value/saturation fixed so the mark always reads bright.
  const hue = h % 360;
  return { initials: startupInitials(name), bg: `hsl(${hue} 72% 46%)`, fg: '#fff' };
}
