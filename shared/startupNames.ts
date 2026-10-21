/** Funny default identities ('Quantum Burrito' / 'basedfounder4207'). Every funding profile gets one at creation
 *  (and unnamed legacy profiles on their next read), so nobody is ever unnamed; players rename in Game options. */
export const USER_ADJ = ['scrappy', 'stealth', 'based', 'lean', 'vibe', 'moonshot', 'zero', 'hyper', 'degen', 'first'] as const;
export const USER_NOUN = ['founder', 'builder', 'hacker', 'maxi', 'dev', 'ceo', 'wizard', 'ghost'] as const;
export const CO_ADJ = ['Quantum', 'Neural', 'Hyper', 'Stealth', 'Autonomous', 'Synthetic', 'Agentic', 'Vertical', 'Based', 'Decentralized'] as const;
export const CO_NOUN = ['Burrito', 'Sourdough', 'Labs', 'Protocol', 'Dynamics', 'Intelligence', 'Mesh', 'Fusion', 'Compute', 'Systems'] as const;

/** FNV-1a over the seed: the same device always gets the same default (retries/backfills agree). */
function hash(seed: string, salt: number): number {
  let h = (2166136261 ^ salt) >>> 0;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619) >>> 0;
  return h;
}
export function defaultFundingNames(seed: string): { startupName: string; nickname: string } {
  const at = <T>(list: readonly T[], salt: number) => list[hash(seed, salt) % list.length]!;
  return {
    startupName: `${at(CO_ADJ, 1)} ${at(CO_NOUN, 2)}`,
    // 4-digit suffix: 10x8x9000 = 720k names (2 digits gave 7,200 -> ~60 duplicate pairs among ~950 players, and
    // nicknames key nameplate summaries / click-any-player lookups). Longest is 19 chars (limit 24).
    nickname: `${at(USER_ADJ, 3)}${at(USER_NOUN, 4)}${1000 + hash(seed, 5) % 9000}`,
  };
}
