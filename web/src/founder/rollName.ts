/**
 * Generated meme startup names for the founder ladder's found-your-startup card (PLAN "Naming:
 * generated + reroll — no typing, no moderation risk"). Reuses the existing name generator's word
 * lists (shared/startupNames.ts), so a rolled name reads like the rest of the game ("Quantum
 * Sourdough", "Agentic Protocol"). Pure: the card owns the DOM and the reroll button.
 */
import { CO_ADJ, CO_NOUN, USER_ADJ, USER_NOUN } from '@gtasf/shared/startupNames';

/** Roll a fresh random startup name. `rng` is injectable so the roll is unit-testable. */
export function rollStartupName(rng: () => number = Math.random): string {
  const adj = CO_ADJ[Math.floor(rng() * CO_ADJ.length) % CO_ADJ.length]!;
  const noun = CO_NOUN[Math.floor(rng() * CO_NOUN.length) % CO_NOUN.length]!;
  return `${adj} ${noun}`;
}

/** Roll a name that differs from `previous` so the 🎲 button always visibly changes something. */
export function rerollStartupName(previous: string, rng: () => number = Math.random): string {
  for (let attempt = 0; attempt < 8; attempt++) {
    const next = rollStartupName(rng);
    if (next !== previous) return next;
  }
  return rollStartupName(rng);
}

/**
 * A generated founder nickname (e.g. "based founder 4207"), used only as a fallback when a profile has
 * no nickname yet — the funding profile already mints one at creation, so this rarely fires. Matches
 * the shape of shared/startupNames.ts's default nicknames so the leaderboard reads consistently.
 */
export function rollNickname(rng: () => number = Math.random): string {
  const adj = USER_ADJ[Math.floor(rng() * USER_ADJ.length) % USER_ADJ.length]!;
  const noun = USER_NOUN[Math.floor(rng() * USER_NOUN.length) % USER_NOUN.length]!;
  return `${adj}${noun}${1000 + Math.floor(rng() * 9000)}`;
}
