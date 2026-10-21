/**
 * Founder Rank (flag founderRank) — the RANK UP moment as a centre splash (critic 03:35: GTA V's rank only *speaks* at
 * rank-up, full-width centre): a dark band, 'RANK UP' in gold, 'LV n · TITLE' beneath. Pure DOM, ~2.6 s, reduced-motion safe.
 */
import { flags } from '@gtasf/shared/flags';
import { centerSlot } from '../hud/centerSlot';
import './rankUp.css';

export interface RankUpSplash { show(level: number, title: string): void; dispose(): void }

export function createRankUpSplash(parent: HTMLElement = document.body): RankUpSplash {
  const band = document.createElement('section'); band.className = 'gt-rank-up'; band.hidden = true; band.setAttribute('role', 'status');
  const word = document.createElement('div'); word.className = 'gt-rank-up-word'; word.textContent = 'RANK UP';
  const line = document.createElement('div'); line.className = 'gt-rank-up-line';
  band.append(word, line); parent.append(band);
  let timer: ReturnType<typeof setTimeout> | undefined;
  return {
    show(level, title) {
      const text = `LV ${level} · ${title.toUpperCase()}`;
      const showBand = () => { line.textContent = text; band.hidden = false; band.classList.remove('is-in'); void band.offsetWidth; band.classList.add('is-in'); };
      const hideBand = () => { if (timer) clearTimeout(timer); band.classList.remove('is-in'); timer = setTimeout(() => { band.hidden = true; }, 350); };
      // critic N34: take a turn in the centre slot with MISSION PASSED and the payout card instead of overprinting them.
      if (flags.centerSlotQueue) { centerSlot.enqueue({ naturalMs: 2600, order: 2 /* after the payout card */, show: showBand, hide: hideBand }); return; }
      showBand();
      if (timer) clearTimeout(timer);
      timer = setTimeout(hideBand, 2600);
    },
    dispose() { if (timer) clearTimeout(timer); band.remove(); },
  };
}
