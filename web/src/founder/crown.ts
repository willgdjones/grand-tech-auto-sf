/**
 * Founder-ladder EARNED crown + mini leaderboard (PLAN "Crown and OUTBID": "the crown becomes earned — the
 * highest live valuation holds it"). A compact top banner for the LADDER BUCKET ONLY, shown in free roam
 * after Seed (hidden under the HUD lock before then via hudLock's EXTRA_HIDDEN). It reads the funding
 * leaderboard only — "#N of M · the crown: <top startup>" — so there is no payment path and OUTBID stays
 * hidden for ladder players (ladder.css `body.gt-founder-ladder .gt-outbid-banner`). Control/OUTBID untouched.
 */
import './ladder.css';

export interface FounderCrownData {
  /** The player's live rank by valuation (1 = crown holder), or null when unranked (no valuation yet). */
  readonly rank: number | null;
  /** Total ranked founders on the live board (its size), or null when unknown (the board payload is capped at the
   *  top 50, so its length is not the field size); clamped so it is never below the player's rank. */
  readonly total: number | null;
  /** The #1 startup's name (the current crown holder), or null when nobody has a valuation yet. */
  readonly crownHolder: string | null;
}

export interface FounderCrown {
  readonly element: HTMLElement;
  set(data: FounderCrownData): void;
  /** Founder Rank (flag founderRank, critique #20): 'LV n · TITLE' + a thin XP bar on the chip; null hides it. */
  setRank(rank: { level: number; title: string; into: number; span: number } | null): void;
  destroy(): void;
}

/** Build the earned-crown banner and attach it to `parent`. Call `set` on every leaderboard update. */
export function createFounderCrown(parent: HTMLElement): FounderCrown {
  const banner = document.createElement('section');
  banner.className = 'gt-founder-crown';
  banner.setAttribute('aria-live', 'polite');
  banner.setAttribute('aria-label', 'Founder leaderboard and crown');
  const icon = document.createElement('span'); icon.className = 'gt-founder-crown-icon'; icon.textContent = '👑';
  const text = document.createElement('span'); text.className = 'gt-founder-crown-text';
  const rankTag = document.createElement('span'); rankTag.className = 'gt-founder-crown-rank'; rankTag.hidden = true;
  const rankLabel = document.createElement('span');
  const rankBar = document.createElement('span'); rankBar.className = 'gt-founder-crown-rank-bar';
  const rankFill = document.createElement('i'); rankBar.append(rankFill);
  rankTag.append(rankLabel, rankBar);
  banner.append(icon, text, rankTag);
  parent.append(banner);

  let disposed = false;
  return {
    element: banner,
    set(data) {
      if (disposed) return;
      const holder = data.crownHolder;
      const total = data.total === null ? null : Math.max(data.total, data.rank ?? 0);
      const of = total === null ? '' : ` OF ${total}`;
      if (data.rank === 1) {
        text.textContent = total !== null && total > 1 ? `YOU HOLD THE CROWN · #1${of}` : 'YOU HOLD THE CROWN';
        banner.classList.add('gt-founder-crown-mine');
      } else {
        banner.classList.remove('gt-founder-crown-mine');
        if (data.rank && holder) text.textContent = `#${data.rank}${of} · CROWN: ${holder.toUpperCase()}`;
        else if (holder) text.textContent = `CROWN: ${holder.toUpperCase()} · RAISE YOUR VALUATION TO CLIMB`;
        else text.textContent = 'THE CROWN IS OPEN · RAISE YOUR VALUATION TO TAKE IT';
      }
    },
    setRank(rank) {
      if (disposed) return;
      rankTag.hidden = !rank;
      if (!rank) return;
      rankLabel.textContent = `LV ${rank.level}`; // bare level; the full rank lives in the jobs phone (critic 03:35)
      rankFill.style.width = `${Math.round(Math.max(0, Math.min(1, rank.span ? rank.into / rank.span : 0)) * 100)}%`;
      rankTag.title = `${rank.into} / ${rank.span} XP to level ${rank.level + 1}`;
    },
    destroy() { if (disposed) return; disposed = true; banner.remove(); },
  };
}
