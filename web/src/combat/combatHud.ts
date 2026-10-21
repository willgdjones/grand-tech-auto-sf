/**
 * GTA V pivot — LANE B (combat & police): the health + armour HUD.
 *
 * A standalone top-right overlay (NOT part of playableHud's funding HUD top-left, NOT the bottom-left radar)
 * so it never clashes with the gold "Funded stars" row — the wanted-level stars (step 5) will sit just under
 * these bars, grouping all combat state top-right. Two slim SA-themed bars: health (green→red) over armour
 * (blue). Hidden until the 18+ gate is passed.
 */
import './combat.css';
import { flags } from '@gtasf/shared/flags';
import { MAX_ARMOUR, MAX_HEALTH } from '@gtasf/shared/combat/economy';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}

export interface CombatHud {
  readonly element: HTMLElement;
  setHealth(health: number): void;
  setArmour(armour: number): void;
  /** Wanted level 0–5 (red police stars under the bars; hidden at 0). */
  setWanted(level: number): void;
  /** Flash the lit wanted stars while the player is out of police sight (heat can cool down). */
  setEscaping(on: boolean): void;
  /** wantedEscape (gtasf-66lvh): the server's escape phase — 'seen' flashes the stars red/blue; 'evading'/'searching'
   *  dims them and shows a bar filling toward losing the cops (progress 0–1, seconds left, cover hint). */
  setEscape(phase: 'seen' | 'evading' | 'searching' | null, progress?: number, secondsLeft?: number, hint?: string): void;
  show(): void;
  hide(): void;
  destroy(): void;
}

const WANTED_MAX = 5;

export function createCombatHud(parent: HTMLElement = document.body): CombatHud {
  const root = el('div', 'gt-combat-hud');
  root.hidden = true;

  const healthRow = el('div', 'gt-combat-bar gt-combat-health');
  const healthFill = el('div', 'gt-combat-bar-fill');
  const healthIcon = el('span', 'gt-combat-bar-icon');
  healthIcon.textContent = '♥';
  healthRow.append(healthIcon, healthFill);

  const armourRow = el('div', 'gt-combat-bar gt-combat-armour');
  const armourFill = el('div', 'gt-combat-bar-fill');
  const armourIcon = el('span', 'gt-combat-bar-icon');
  armourIcon.textContent = '🛡';
  armourRow.append(armourIcon, armourFill);

  // Wanted stars: red police stars under the bars (distinct from the gold funding "Funded stars"); hidden at 0.
  const wantedRow = el('div', 'gt-combat-wanted');
  wantedRow.hidden = true;
  const wantedStars: HTMLElement[] = [];
  for (let i = 0; i < WANTED_MAX; i++) {
    const star = el('span', 'gt-combat-wanted-star');
    star.textContent = '★';
    wantedStars.push(star);
    wantedRow.append(star);
  }

  // gtasf-66lvh: escape bar under the stars (EVADING / SEARCHING + a fill toward losing them).
  const escapeRow = el('div', 'gt-combat-escape');
  let escapeLeft = -1, escapePhase: string | undefined, escapeMovedAt = 0, escapeHoldTimer = 0; // escapeHoldLabel
  escapeRow.hidden = true;
  const escapeLabel = el('span', 'gt-combat-escape-label');
  const escapeTrack = el('div', 'gt-combat-escape-track');
  const escapeFill = el('div', 'gt-combat-escape-fill');
  escapeTrack.append(escapeFill);
  escapeRow.append(escapeLabel, escapeTrack);
  root.append(healthRow, armourRow, wantedRow, escapeRow);
  root.setAttribute('aria-hidden', 'true'); // decorative; the authoritative state is server-side
  parent.append(root);

  let health = MAX_HEALTH;
  let armour = 0;

  function paint(): void {
    const h = Math.max(0, Math.min(1, health / MAX_HEALTH));
    const a = Math.max(0, Math.min(1, armour / MAX_ARMOUR));
    healthFill.style.width = `${h * 100}%`;
    // Health tint warms to red as it drops.
    healthFill.style.background = h > 0.5 ? '#3ec46d' : h > 0.25 ? '#d6b63c' : '#d64141';
    armourFill.style.width = `${a * 100}%`;
    armourRow.hidden = armour <= 0; // GTA hides the armour bar when you have none
  }
  paint();

  return {
    element: root,
    setHealth(value: number) { health = value; paint(); },
    setArmour(value: number) { armour = value; paint(); },
    setWanted(level: number) {
      const lit = Math.max(0, Math.min(WANTED_MAX, Math.floor(level)));
      wantedRow.hidden = lit <= 0;
      wantedStars.forEach((star, i) => star.classList.toggle('lit', i < lit));
    },
    setEscaping(on: boolean) { wantedRow.classList.toggle('gt-combat-wanted-escaping', on); },
    setEscape(phase, progress = 0, secondsLeft = 0, hint = '') {
      const wanted = !wantedRow.hidden;
      wantedRow.classList.toggle('gt-combat-wanted-seen', wanted && phase === 'seen');
      wantedRow.classList.toggle('gt-combat-wanted-hidden', wanted && (phase === 'evading' || phase === 'searching'));
      const show = wanted && (phase === 'evading' || phase === 'searching');
      escapeRow.hidden = !show;
      if (!show) { clearTimeout(escapeHoldTimer); escapePhase = undefined; return; } // back from SEEN: the countdown starts fresh
      escapeRow.dataset.phase = phase!;
      // escapeHoldLabel: the server holds the clock until a unit has found you (escapeWaitsForSighting, up to 30 s), and a
      // countdown frozen at 'EVADING 9s' read as broken. Once it hasn't moved for 1.5 s, say why instead of a number.
      const now = performance.now(), left = Math.ceil(secondsLeft);
      if (left !== escapeLeft || phase !== escapePhase) { escapeLeft = left; escapePhase = phase; escapeMovedAt = now; }
      const label = (held: boolean) => `${phase === 'searching' ? 'SEARCHING' : 'EVADING'}${held ? ' · SFPD on the way' : ` ${left}s`}${hint ? ` · ${hint}` : ''}`;
      escapeLabel.textContent = label(flags.escapeHoldLabel && now - escapeMovedAt > 1500);
      // A held clock doesn't change, so the server sends nothing (WANTED_ESCAPE goes on change): switch on our own clock.
      if (flags.escapeHoldLabel) { clearTimeout(escapeHoldTimer); escapeHoldTimer = window.setTimeout(() => { if (!escapeRow.hidden) escapeLabel.textContent = label(true); }, 1600); }
      escapeFill.style.width = `${Math.round(Math.max(0, Math.min(1, progress)) * 100)}%`;
    },
    show() { root.hidden = false; },
    hide() { root.hidden = true; },
    destroy() { clearTimeout(escapeHoldTimer); root.remove(); },
  };
}
