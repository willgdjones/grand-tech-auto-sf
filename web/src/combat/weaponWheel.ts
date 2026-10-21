/**
 * GTA V pivot — LANE B (combat & police), step 2: the weapon wheel + current-weapon chip.
 *
 * A persistent bottom-right chip shows the equipped weapon and its ammo (tap it, or press Tab, to open the
 * radial wheel). The wheel lays WEAPON_ORDER out in a ring: owned weapons are selectable, unowned are dimmed.
 * Click/tap a slot, or press a digit 1–5, to equip. Keyboard shortcuts are ignored while a text field is
 * focused or the game reports a modal open.
 */
import './combat.css';
import { WEAPON_ORDER, WEAPONS, type WeaponId } from '@gtasf/shared/combat/weapons';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text) node.textContent = text;
  return node;
}

function typingInField(): boolean {
  const a = document.activeElement as HTMLElement | null;
  if (!a) return false;
  const tag = a.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || a.isContentEditable;
}

export interface WeaponWheelOptions {
  parent?: HTMLElement;
  isOwned(id: WeaponId): boolean;
  getCurrent(): WeaponId;
  /** Ammo in the current magazine, or null for melee / unlimited. */
  getAmmo(id: WeaponId): number | null;
  onSelect(id: WeaponId): void;
  /** Suppress keyboard shortcuts while the game has a modal/panel open. */
  isBlocked?(): boolean;
  /** Buy price label for an unowned, for-sale weapon (gun shop), or null if not buyable here. */
  priceLabel?(id: WeaponId): string | null;
  /** Buy an unowned, for-sale weapon (gun shop). */
  onBuy?(id: WeaponId): void;
  /** Whether the current weapon is mid-reload (shows ⟳ on the chip). */
  isReloading?(): boolean;
  /** Manual reload (R). */
  onReload?(): void;
  /** Body armour at the gun shop (vitalsPickups): its price label, or null to hide the button. */
  armourLabel?(): string | null;
  onBuyArmour?(): void;
}

export interface WeaponWheel {
  readonly element: HTMLElement;
  readonly isOpen: boolean;
  open(): void;
  close(): void;
  toggle(): void;
  /** Re-read owned/current/ammo and repaint. */
  refresh(): void;
  /** Show a gun-shop message inside the open wheel (HUD notices sit under its backdrop); cleared on close. */
  setStatus(text: string | null): void;
  destroy(): void;
}

export function createWeaponWheel(options: WeaponWheelOptions): WeaponWheel {
  const parent = options.parent ?? document.body;
  const blocked = () => options.isBlocked?.() ?? false;

  // Persistent chip (also the open button).
  const chip = el('button', 'gt-weapon-chip');
  chip.type = 'button';
  chip.setAttribute('aria-haspopup', 'true');
  const chipIcon = el('span', 'gt-weapon-chip-icon');
  const chipName = el('span', 'gt-weapon-chip-name');
  const chipAmmo = el('span', 'gt-weapon-chip-ammo');
  chip.append(chipIcon, chipName, chipAmmo);

  // Radial wheel overlay.
  const overlay = el('div', 'gt-weapon-wheel');
  overlay.hidden = true;
  overlay.setAttribute('role', 'menu');
  const ring = el('div', 'gt-weapon-wheel-ring');
  const slots = new Map<WeaponId, { slot: HTMLButtonElement; ammo: HTMLElement }>();
  const n = WEAPON_ORDER.length;
  WEAPON_ORDER.forEach((id, i) => {
    const spec = WEAPONS[id];
    const slot = el('button', 'gt-weapon-slot');
    slot.type = 'button';
    slot.dataset.weapon = id;
    slot.setAttribute('role', 'menuitemradio');
    // Place around a circle (top = index 0).
    const angle = (i / n) * Math.PI * 2 - Math.PI / 2;
    slot.style.left = `${50 + Math.cos(angle) * 38}%`;
    slot.style.top = `${50 + Math.sin(angle) * 38}%`;
    const icon = el('span', 'gt-weapon-slot-icon', spec.icon);
    const name = el('span', 'gt-weapon-slot-name', spec.name);
    const key = el('span', 'gt-weapon-slot-key', String(i + 1));
    const ammo = el('span', 'gt-weapon-slot-ammo');
    slot.append(key, icon, name, ammo);
    slot.addEventListener('click', () => select(id));
    ring.append(slot);
    slots.set(id, { slot, ammo });
  });
  const hub = el('div', 'gt-weapon-wheel-hub', 'Weapons');
  ring.append(hub);
  const status = el('div', 'gt-weapon-wheel-status'); status.setAttribute('role', 'status'); status.hidden = true;
  // Body armour (vitalsPickups): a buy button under the hub.
  const armourBtn = options.onBuyArmour ? el('button', 'gt-weapon-armour') : null;
  if (armourBtn) { armourBtn.type = 'button'; armourBtn.addEventListener('click', () => options.onBuyArmour?.()); ring.append(armourBtn); }
  overlay.append(ring, status);

  parent.append(chip, overlay);

  let open = false;

  function select(id: WeaponId): void {
    if (options.isOwned(id)) {
      options.onSelect(id);
      refresh();
      close();
      return;
    }
    // Unowned but sold at the gun shop: buy it (stays open so the player sees it become owned).
    if (options.onBuy && options.priceLabel?.(id) != null) {
      options.onBuy(id);
    }
  }

  function refresh(): void {
    const current = options.getCurrent();
    const spec = WEAPONS[current];
    chipIcon.textContent = spec.icon;
    if (armourBtn) { const label = options.armourLabel?.() ?? null; armourBtn.hidden = label === null; armourBtn.textContent = label ? `🛡️ Body armour ${label}` : ''; }
    chipName.textContent = spec.name;
    const ammo = options.getAmmo(current);
    chipAmmo.textContent = spec.melee ? '∞' : options.isReloading?.() ? '⟳' : ammo === null ? '' : String(ammo);
    for (const [id, { slot, ammo: ammoEl }] of slots) {
      const owned = options.isOwned(id);
      const price = owned ? null : (options.priceLabel?.(id) ?? null);
      slot.classList.toggle('owned', owned);
      slot.classList.toggle('current', id === current);
      slot.classList.toggle('buyable', !owned && price != null);
      slot.disabled = !owned && price == null; // unowned & not for sale here
      if (owned) {
        const a = options.getAmmo(id);
        ammoEl.textContent = WEAPONS[id].melee ? '' : a === null ? '' : String(a);
      } else {
        ammoEl.textContent = price ?? ''; // show the buy price on sold slots
      }
    }
  }

  function doOpen(): void { if (open) return; open = true; overlay.hidden = false; refresh(); }
  function setStatus(text: string | null): void { status.textContent = text ?? ''; status.hidden = !text; }
  function doClose(): void { if (!open) return; open = false; overlay.hidden = true; setStatus(null); }
  function close(): void { doClose(); }

  chip.addEventListener('click', () => { if (!blocked()) toggle(); });
  overlay.addEventListener('click', event => { if (event.target === overlay) doClose(); }); // click-away

  function toggle(): void { open ? doClose() : doOpen(); }

  function onKey(event: KeyboardEvent): void {
    if (blocked() || typingInField() || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.code === 'Tab') { event.preventDefault(); toggle(); return; }
    if (event.code === 'KeyR' && options.onReload) { event.preventDefault(); options.onReload(); return; }
    if (open && event.code === 'Escape') { event.preventDefault(); doClose(); return; }
    const digit = /^Digit([1-5])$/.exec(event.code);
    if (digit) {
      const id = WEAPON_ORDER[Number(digit[1]) - 1];
      if (id) { event.preventDefault(); select(id); }
    }
  }
  window.addEventListener('keydown', onKey);

  refresh();

  return {
    element: chip,
    get isOpen() { return open; },
    open: doOpen,
    close: doClose,
    toggle,
    refresh,
    setStatus,
    destroy() { window.removeEventListener('keydown', onKey); chip.remove(); overlay.remove(); },
  };
}
