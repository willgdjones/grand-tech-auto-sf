import { flags } from '@gtasf/shared/flags';
import { LOOK_TIERS, decodeAppearance, encodeAppearance, tierForRound, tierUnlocked, unlockRoundLabel } from '@gtasf/shared/content/cosmetics';
import type { Appearance, LookTier } from '@gtasf/shared/content/cosmetics';
import type { FundingRound } from '@gtasf/shared/funding';
import './wardrobe.css';

export type WardrobeField = 'outfit' | 'hair' | 'hairColor' | 'accessory';
export interface WardrobeChoice { index: number; label: string; tier?: number }
/** Catalogues must describe choices the installed avatar renderer supports. */
export interface WardrobeOptions {
  getAppearance(): Appearance;
  getRound(): Pick<FundingRound, 'id'>;
  onChange(value: Appearance): void;
  choices: Partial<Record<WardrobeField, readonly WardrobeChoice[]>>;
  onUnlock?(tier: LookTier): void;
  onModalChange?(open: boolean): void;
}
const FIELDS: readonly [WardrobeField, string][] = [
  ['outfit', 'Outfit'], ['hair', 'Hairstyle'], ['hairColor', 'Hair colour'], ['accessory', 'Accessory'],
];

/** O-key routing belongs to the action bus; the returned launcher supports touch. */
export function createWardrobe(options: WardrobeOptions) {
  if (!flags.characterLooks) return null;
  const dialog = document.createElement('dialog');
  dialog.className = 'gt-wardrobe sa-panel sa-panel--strong';
  const title = document.createElement('h2'); title.className = 'sa-title'; title.textContent = 'Wardrobe';
  title.id = 'gt-wardrobe-title'; dialog.setAttribute('aria-labelledby', title.id);
  const subtitle = document.createElement('p'); subtitle.className = 'gt-wardrobe-stage';
  const form = document.createElement('form'); form.method = 'dialog';
  const fields = document.createElement('div'); fields.className = 'gt-wardrobe-fields';
  const explain = document.createElement('p'); explain.className = 'gt-wardrobe-explain'; explain.hidden = true;
  const tiers = document.createElement('ol'); tiers.className = 'gt-wardrobe-tiers'; tiers.setAttribute('aria-label', 'Funding look unlocks');
  const actions = document.createElement('div'); actions.className = 'gt-wardrobe-actions';
  const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = 'Cancel';
  const apply = document.createElement('button'); apply.type = 'submit'; apply.textContent = 'Wear this look';
  actions.append(cancel, apply); form.append(fields, explain, tiers, actions); dialog.append(title, subtitle, form); document.body.append(dialog);
  const launcher = document.createElement('button'); launcher.type = 'button'; launcher.className = 'gt-wardrobe-launch';
  launcher.textContent = 'Wardrobe · O'; launcher.setAttribute('aria-haspopup', 'dialog');
  let draft = options.getAppearance(), lastTier = tierForRound(options.getRound()).index, disposed = false, announcedOpen = false;
  let previousFocus: HTMLElement | null = null;
  // lookUnlockReward (critic 20c / lane D): the highest tier this device has seen in the wardrobe, so a tier unlocked since
  // reads NEW (gold) the first time the wardrobe opens after it.
  const SEEN_KEY = 'gtasf.wardrobe.seenTier.v1';
  const ANNOUNCED_KEY = 'gtasf.wardrobe.announcedTier.v1';
  const seenTier = () => { try { return Number(localStorage.getItem(SEEN_KEY) ?? 0) || 0; } catch { return 0; } };
  const markSeen = (index: number) => { try { localStorage.setItem(SEEN_KEY, String(Math.max(index, seenTier()))); } catch { /* storage blocked */ } };
  let newSince = 0; // the seen tier at this opening (rows above it, up to the active tier, are NEW)

  function render() {
    const round = options.getRound(), active = tierForRound(round);
    subtitle.textContent = `${active.label} look · All choices are cosmetic`;
    fields.replaceChildren();
    for (const [field, label] of FIELDS) {
      const row = document.createElement('label'), name = document.createElement('span'); name.textContent = label;
      const select = document.createElement('select'); select.name = field; select.setAttribute('aria-label', label);
      const choices = options.choices[field] ?? [];
      const unavailable = document.createElement('option'); unavailable.textContent = 'More looks coming soon'; unavailable.value = '';
      if (!choices.length) { select.append(unavailable); select.disabled = true; }
      for (const choice of choices) {
        if (!Number.isInteger(choice.index) || choice.index < 0 || choice.index > 7) throw new Error(`Invalid ${field} catalogue index`);
        const option = document.createElement('option'), locked = !tierUnlocked(choice.tier ?? 0, round);
        option.value = String(choice.index); option.disabled = locked;
        option.textContent = locked ? `${choice.label} — ${unlockRoundLabel(choice.tier ?? 0)} required` : choice.label;
        select.append(option);
      }
      if (choices.length) {
        if (!choices.some(choice => choice.index === draft[field])) {
          const current = document.createElement('option'); current.value = String(draft[field]); current.textContent = 'Current look';
          select.prepend(current);
        }
        select.value = String(draft[field]);
      }
      select.addEventListener('change', () => {
        const choice = choices.find(c => c.index === Number(select.value));
        if (choice && tierUnlocked(choice.tier ?? 0, options.getRound())) draft = { ...draft, [field]: choice.index };
      });
      row.append(name, select); fields.append(row);
    }
    tiers.replaceChildren();
    const reward = flags.lookUnlockReward;
    // No 'worn automatically' line (lane D 10-19): the tier garment doesn't render on Meshy bodies, so it would promise a
    // change the player can't see. The tier row + chip say what's true; visible tier dress is gtasf-4vgje.
    explain.hidden = true;
    for (const tier of LOOK_TIERS) {
      const item = document.createElement('li'), unlocked = tierUnlocked(tier.index, round);
      item.dataset.unlocked = String(unlocked);
      item.textContent = `${tier.label} · ${tier.outfit.replaceAll('-', ' ')} · ${unlocked ? 'Unlocked' : `${unlockRoundLabel(tier.index)} required`}`;
      if (reward && unlocked) {
        const isNew = tier.index > 0 && tier.index > newSince, wearing = tier.index === active.index;
        if (isNew || wearing) {
          const chip = document.createElement('span'); chip.className = 'gt-wardrobe-chip'; chip.textContent = isNew ? 'NEW' : flags.meshyTierDress ? 'WEARING' : 'CURRENT'; // the garment renders only with meshyTierDress
          item.prepend(chip); item.classList.toggle('is-new', isNew); item.classList.toggle('is-current', wearing);
        }
      }
      tiers.append(item);
    }
  }
  function onClose() {
    // Native close events are queued. Do not release a dialog already reopened.
    if (dialog.open || !announcedOpen) return;
    announcedOpen = false; options.onModalChange?.(false);
    if (previousFocus?.isConnected) previousFocus.focus();
  }
  function hide() { if (dialog.open) dialog.close(); onClose(); }
  function show() {
    if (disposed || dialog.open) return;
    previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    newSince = seenTier(); draft = options.getAppearance(); render(); document.exitPointerLock?.(); dialog.showModal();
    if (flags.lookUnlockReward) markSeen(tierForRound(options.getRound()).index); // NEW shows on this opening only
    announcedOpen = true; options.onModalChange?.(true);
    (dialog.querySelector<HTMLSelectElement>('select:not(:disabled)') ?? cancel).focus();
  }
  function refresh() {
    if (disposed) return;
    const tier = tierForRound(options.getRound());
    if (tier.index > lastTier) {
      if (!flags.lookUnlockReward) options.onUnlock?.(tier);
      else {
        // Announce each tier once per device: lastTier starts from the boot-time round (the default before the profile
        // lands), so without this a reload could re-announce the player's current look.
        let announced = 0; try { announced = Number(localStorage.getItem(ANNOUNCED_KEY) ?? 0) || 0; } catch { /* storage blocked */ }
        if (tier.index > announced) { options.onUnlock?.(tier); try { localStorage.setItem(ANNOUNCED_KEY, String(tier.index)); } catch { /* blocked */ } }
      }
    }
    lastTier = tier.index;
    if (dialog.open) render();
  }
  form.addEventListener('submit', event => {
    event.preventDefault();
    const current = options.getAppearance(), round = options.getRound();
    let next = current;
    // Recheck current eligibility: funding can change while the dialog is open.
    for (const [field] of FIELDS) {
      const choice = options.choices[field]?.find(c => c.index === draft[field]);
      if (choice && tierUnlocked(choice.tier ?? 0, round)) next = { ...next, [field]: choice.index };
    }
    options.onChange(decodeAppearance(encodeAppearance(next))); hide();
  });
  cancel.addEventListener('click', hide); launcher.addEventListener('click', show);
  launcher.addEventListener('pointerdown', event => {
    if (event.pointerType === 'touch' && !event.isPrimary) { event.preventDefault(); show(); }
  });
  dialog.addEventListener('cancel', event => { event.preventDefault(); hide(); });
  // O opens the wardrobe (the action bus), so O closes it too. While it's open game input is paused, so the key would
  // otherwise type into the focused select (native type-ahead jumps Outfit to 'Ocean') — handle it here instead.
  dialog.addEventListener('keydown', event => {
    if (event.code !== 'KeyO' || event.ctrlKey || event.metaKey || event.altKey) return;
    event.preventDefault(); event.stopPropagation(); hide();
  });
  dialog.addEventListener('close', onClose);
  dialog.addEventListener('click', event => { if (event.target === dialog) {
    const box = dialog.getBoundingClientRect();
    if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) hide();
  } });
  return { launcher, show, hide, refresh, get isOpen() { return dialog.open; },
    dispose() { disposed = true; hide(); dialog.remove(); launcher.remove(); } };
}
