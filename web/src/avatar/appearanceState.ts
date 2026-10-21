import { FUNDING_ROUNDS, type FundingRound } from '@gtasf/shared/funding';
import { decodeAppearance, defaultAppearance, encodeAppearance, resolveLook, type Appearance } from '@gtasf/shared/content/cosmetics';

export const APPEARANCE_STORAGE_KEY = 'gtasf.appearance.v1';
type CosmeticStorage = Pick<Storage, 'getItem' | 'setItem'>;

/** Local cosmetic preferences; funding stages always come from the current profile. */
export function createAppearanceState(options: {
  fallbackOutfit?: number;
  legacyOutfitCount: number;
  storage?: CosmeticStorage | null;
}) {
  let storage = options.storage;
  if (storage === undefined) {
    try { storage = globalThis.localStorage; } catch { storage = null; }
  }
  let current = { ...defaultAppearance(), outfit: options.fallbackOutfit ?? 0 };
  try {
    const saved = storage?.getItem(APPEARANCE_STORAGE_KEY);
    const id = saved && /^\d+$/.test(saved) ? Number(saved) : NaN;
    if (Number.isSafeInteger(id) && id >= 0 && id <= 0x3ffffff) {
      current = { ...decodeAppearance(id), stageRound: 0 };
    } else {
      const legacy = storage?.getItem('gtasf.outfit');
      const outfit = legacy?.trim() ? Number(legacy) : NaN;
      if (Number.isSafeInteger(outfit) && outfit >= 0) current.outfit = outfit % Math.max(1, options.legacyOutfitCount);
    }
  } catch { /* A blocked storage area still permits in-memory cosmetic changes. */ }
  current = decodeAppearance(encodeAppearance(current));
  let round = FUNDING_ROUNDS[0]!;
  let look = resolveLook(current, round);

  return {
    get current(): Appearance { return current; },
    get look() { return look; },
    get encoded() { return encodeAppearance(current); },
    set(value: Appearance): Appearance {
      current = decodeAppearance(encodeAppearance({ ...value, stageRound: current.stageRound }));
      look = resolveLook(current, round);
      try {
        // Never restore earned tiers from local storage. The compatibility key keeps legacy cycling usable.
        storage?.setItem(APPEARANCE_STORAGE_KEY, String(encodeAppearance({ ...current, stageRound: 0 })));
        storage?.setItem('gtasf.outfit', String(current.outfit));
      } catch { /* Applying a look does not require storage access. */ }
      return current;
    },
    setRound(value?: Pick<FundingRound, 'id'>) {
      const index = Math.max(0, FUNDING_ROUNDS.findIndex(candidate => candidate.id === value?.id));
      if (current.stageRound === index) return;
      round = FUNDING_ROUNDS[index]!;
      current = { ...current, stageRound: index };
      look = resolveLook(current, round);
    },
  };
}
