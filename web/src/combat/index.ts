/**
 * GTA V pivot — LANE B (combat & police): the client combat runtime (step 1).
 *
 * Owns the player's health/armour, the 18+ gate, the health/armour HUD, and the death→WASTED→respawn flow.
 * All behind flags.combat (createCombat returns null when off, so the rest of the game is unchanged).
 *
 * Damage sources arrive in later steps (weapons, server hits, police); they call `damage()` / `kill()`.
 * Death posts the authoritative valuation cost to /api/combat/death (−2% wasted / −5% busted), shows the
 * WASTED/BUSTED screen, then asks main.ts (via the injected `respawn` closure, which owns player movement)
 * to move the player to SF General. The cost is self-reported in v1 (idempotent, self-inflicted); step 5's
 * server-driven death will debit directly in WorldDO.
 */
import type { Camera, Scene, Vector3 } from 'three';
import { flags } from '@gtasf/shared/flags';
import { type DeathKind, MAX_ARMOUR, MAX_HEALTH } from '@gtasf/shared/combat/economy';
import { canFire, isWeaponId, WEAPONS, type WeaponId } from '@gtasf/shared/combat/weapons';
import { armourPriceCents, cappedShopPrice, gunPriceCents, isForSale } from '@gtasf/shared/combat/gunShop';
import { createAgeGate, isAgeAcknowledged, isAgeDeclined, isGoreEnabled, resetAgeChoice, setGoreEnabled, type AgeGateHandle } from './ageGate';
import { createCombatHud } from './combatHud';
import { createWastedOverlay } from './wastedOverlay';
import { createWeaponWheel, type WeaponWheel } from './weaponWheel';
import { createFireSystem, type FireSystem, type ShotEvent } from './fire';

export { isGoreEnabled, setGoreEnabled, isAgeAcknowledged, isAgeDeclined, resetAgeChoice } from './ageGate';

export interface CombatDeps {
  parent?: HTMLElement;
  /**
   * Game Options content panel. When supplied, combat appends a "Mature content" section (blood & gore
   * toggle once past the gate, and an "Enable mature content" button if the player declined/not yet chosen),
   * fulfilling the gate's "change this later in Game Options" promise.
   */
  optionsPanel?: HTMLElement;
  /** Move the player to the SF General respawn (road-snapped). main.ts owns the pose, so it supplies this. */
  respawn(): void;
  /** Report the new valuation (cents, as a string) after a death cost settles, e.g. to refresh the HUD. */
  onValuation?(currentCents: string): void;
  /** True while a game panel/modal is open, so the weapon wheel's keyboard shortcuts stand down. */
  hasModal?(): boolean;
  /** True while the player is on foot (not driving), so aiming/firing only apply on foot. */
  isOnFoot?(): boolean;
  /** driveBy: the player is in a vehicle (driving or riding) — guns can fire from it. */
  inVehicle?(): boolean;
  /** The player's current funding stage (round stars 0–5) for gun-shop price previews. */
  getStage?(): number;
  /** Current (burned) valuation in cents, for the ≤10% shop price cap preview (the server prices for real). */
  getCurrentCents?(): bigint | null;
  /** This tab's WELCOME session id (binds a server purchase to this exact connection). */
  getSid?(): number | undefined;
  /** Show a brief HUD notice (e.g. gun-shop purchase feedback). */
  onNotify?(text: string): void;
  /** Take down a notice this module put up, if it's still showing (the shoot hint, once the player has fired). */
  onDismissNotice?(text: string): void;
  /** Send the shooter's aim to the server (COMBAT_FIRE) when server hits are on. */
  onServerFire?(weapon: WeaponId, dir: [number, number, number]): void;
  /** Called once when combat goes live (18+ gate accepted). main.ts sends COMBAT_READY so the server may treat
   *  this player as a PvP target; unconfirmed players never are. */
  onCombatStart?(): void;
  /** Combat funnel events (flag combatAnalytics): 18+ gate shown/accept/decline, gun bought. */
  onEvent?(step: 'gate_shown' | 'gate_accept' | 'gate_decline' | 'gun_buy', source?: string): void;
  /** Render hooks for aiming + firing. When omitted, the weapon wheel still works but shots don't render. */
  fire?: {
    scene: Scene;
    camera: Camera;
    canvas: HTMLElement;
    /** Muzzle/gun origin in world space (tracer start); write into `out` and return it. */
    muzzleOrigin(out: Vector3): Vector3;
    /** driveBy: the player's own car (the aim ray passes through it). */
    ignoreRoot?(): import('three').Object3D | undefined;
    /** aimSkinnedCapsule: the local player's avatar, never an aim target. */
    selfRoot?(): import('three').Object3D | undefined;
    /** Lane A hook for real muzzle flash / tracers / blood. */
    onShot?(shot: ShotEvent): void;
    /** twinStick: turn the camera by a drag on the phone FIRE stick. */
    aimLook?(dx: number, dy: number): void;
    /** aimControls: aim-assist candidates (peds, cops, players) at chest height, world metres. */
    aimTargets?(out: import('./aimAssist').AimTarget[]): void;
    /** aimControls lock-on: ease the camera so the crosshair converges on a world point. */
    aimAt?(x: number, y: number, z: number): void;
  };
}

export interface Combat {
  readonly health: number;
  readonly armour: number;
  readonly dead: boolean;
  /** The kind of the latest death screen ('wasted' or 'busted'), null before any — names the respawn (critic N20). */
  readonly lastDeath: DeathKind | null;
  /** The player accepted the 18+ gate and combat is live (they are a PvP target / can be wanted). */
  readonly started: boolean;
  /** Apply damage: armour absorbs first, then health; triggers WASTED at 0 health. */
  damage(amount: number): void;
  /** Give armour (pickups later); clamps to MAX_ARMOUR. */
  addArmour(amount: number): void;
  /** Heal (pickups/regen later); clamps to MAX_HEALTH. */
  heal(amount: number): void;
  /** Force death with a given cause. */
  kill(kind?: DeathKind): void;
  /** Apply a server-authoritative hit on this player (serverHits): reflect damage / show WASTED on kill. */
  serverHit(amount: number, killed: boolean): void;
  /** The server arrested this player (policeBust): play BUSTED; the −5% and the respawn are server-applied. */
  serverBusted(): void;
  /** Server-owned health + armour (vitalsPickups: pickups, purchases, armour-absorbed hits). */
  setVitals(health: number, armour: number): void;
  /** Set the wanted level (0–5) from the server WANTED message. */
  setWanted(level: number): void;
  /** Flash the wanted stars while out of police sight (wantedEscapeFlash). */
  setEscaping(on: boolean): void;
  /** wantedEscape (gtasf-66lvh): server escape phase → flashing stars while seen, EVADING/SEARCHING bar while hidden. */
  setEscape(phase: 'seen' | 'evading' | 'searching' | null, progress?: number, secondsLeft?: number, hint?: string): void;
  /** The equipped weapon. */
  readonly weapon: WeaponId;
  /** aimControls: a target is locked (Z / right-mouse soft lock), so the aim pose + shoulder camera stay up. */
  readonly aimLocked: boolean;
  /** Equip an owned weapon (no-op if not owned). */
  selectWeapon(id: WeaponId): void;
  /** Grant a weapon (gun shop / pickups, step 7), refilling its magazine. */
  giveWeapon(id: WeaponId): void;
  /**
   * A combat-entry action was attempted (weapon pickup, gun shop, robbery/heist, weapon wheel). If the player has
   * already confirmed 18+, run `after` now and return true. Otherwise open the 18+ gate — deferred from load so it
   * never interrupts the founder funnel — and return false; `after` runs once the player accepts. If the player
   * previously declined, the gate stays closed (combat off; re-enable via Game Options) and `after` never runs.
   */
  requestCombat(after?: () => void): boolean;
  /** Per-frame hook (reserved for regen etc.). */
  update(dt: number): void;
  destroy(): void;
}

/** A key typed into a text field (chat, onboarding) is not a game key. */
const typingTarget = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

export function createCombat(deps: CombatDeps): Combat | null {
  if (!flags.combat) return null;

  const parent = deps.parent ?? document.body;
  const hud = createCombatHud(parent);
  const overlay = createWastedOverlay(parent);

  let health = MAX_HEALTH;
  let armour = 0;
  let dead = false, lastDeath: DeathKind | null = null;
  let started = false; // true once past the 18+ gate

  // Weapon inventory (step 2). Start with melee + a starter pistol so weapons are reachable; the gun shop
  // (step 7) sells the SMG/rifle. `ammo` is the rounds in the current magazine per weapon.
  const owned = new Set<WeaponId>(['fists', 'bat', 'pistol']);
  const ammo: Record<WeaponId, number> = {
    fists: 0, bat: 0, pistol: WEAPONS.pistol.magazine, smg: WEAPONS.smg.magazine, rifle: WEAPONS.rifle.magazine,
  };
  let currentWeapon: WeaponId = 'pistol';
  let wheel: WeaponWheel | undefined;
  let fire: FireSystem | undefined;
  let lastFireMs = 0;
  let shootHint: string | undefined; // the one-time 'how to shoot' notice, until the first shot takes it down (critic N15)
  let reloadingUntil = 0; // performance.now() at which the current weapon finishes reloading (0 = not reloading)

  function selectWeapon(id: WeaponId): void {
    if (!owned.has(id)) return;
    currentWeapon = id;
    reloadingUntil = 0; // switching weapons cancels an in-progress reload
    wheel?.refresh();
  }
  function giveWeapon(id: WeaponId): void {
    owned.add(id);
    if (!WEAPONS[id].melee) ammo[id] = WEAPONS[id].magazine;
    wheel?.refresh();
  }

  /** savedLoadout (critique #20): grant the guns this device bought in earlier sessions (server-kept; read-only GET).
   *  Best effort: offline / not founded yet = the starter set, as before. Never changes the equipped weapon. */
  async function restoreLoadout(): Promise<void> {
    try {
      const res = await fetch('/api/combat/loadout', { credentials: 'same-origin' });
      if (!res.ok) return;
      const data = await res.json() as { weapons?: unknown };
      for (const id of Array.isArray(data.weapons) ? data.weapons : []) if (isWeaponId(id) && !owned.has(id)) giveWeapon(id);
    } catch { /* starter set */ }
  }

  /** Gun-shop price preview for an unowned, for-sale weapon at the player's current stage. */
  function priceLabel(id: WeaponId): string | null {
    if (!flags.gunShop || owned.has(id) || !isForSale(id)) return null;
    const current = deps.getCurrentCents?.() ?? null;
    const stage = gunPriceCents(id, deps.getStage?.() ?? 0), cents = current === null ? stage : cappedShopPrice(stage, current);
    return '$' + (Number(cents) / 100).toLocaleString('en-US', { maximumFractionDigits: 0 });
  }

  // Gun-shop results go to the HUD notice AND, while the wheel is open, into the wheel itself: the notice renders under
  // the wheel's backdrop, so the down-round "tap again" warning was unreadable exactly when it mattered. [gtasf-qa]
  const shopNotice = (text: string) => { deps.onNotify?.(text); if (wheel?.isOpen) wheel.setStatus(text); };
  // A purchase that would drop the player a funding round needs a second tap within DOWN_ROUND_CONFIRM_MS (gtasf-euhs0).
  let downRoundArmed: { key: string; until: number } | null = null;
  const confirmedDownRound = (key: string) => downRoundArmed !== null && downRoundArmed.key === key && performance.now() < downRoundArmed.until;
  function armDownRound(key: string, item: string, data: { round?: string; priceCents?: string }): void {
    downRoundArmed = { key, until: performance.now() + 6000 };
    const price = data.priceCents ? ' ($' + (Number(data.priceCents) / 100).toLocaleString('en-US', { maximumFractionDigits: 0 }) + ')' : '';
    shopNotice(`Buying ${item}${price} drops you to ${data.round ?? 'a lower round'}. Tap it again to buy anyway.`);
  }

  /** Buy an unowned weapon from the gun shop (server-authoritative debit); grant + equip it on success. */
  async function buyWeapon(id: WeaponId): Promise<void> {
    if (owned.has(id) || !isForSale(id)) return;
    const allowDownRound = confirmedDownRound(id);
    downRoundArmed = null;
    try {
      const res = await fetch('/api/combat/buy-weapon', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ weapon: id, allowDownRound }),
      });
      const data = await res.json().catch(() => ({})) as { currentCents?: string; error?: string; round?: string; priceCents?: string };
      if (data.error === 'down-round') { armDownRound(id, `the ${WEAPONS[id].name}`, data); return; }
      if (res.ok) {
        giveWeapon(id);
        selectWeapon(id);
        deps.onEvent?.('gun_buy', id);
        if (typeof data.currentCents === 'string') deps.onValuation?.(data.currentCents);
        shopNotice(`Bought the ${WEAPONS[id].name}.`);
      } else {
        // Unaffordable / not connected: leave the wheel open with the price shown and say why.
        shopNotice(data.error === 'unaffordable' ? `You can't afford the ${WEAPONS[id].name} yet.` : `Couldn't buy the ${WEAPONS[id].name}.`);
      }
    } catch {
      shopNotice(`Couldn't buy the ${WEAPONS[id].name}.`);
    }
  }

  /** Body armour price label (vitalsPickups), or null when not on sale / already full. */
  function armourLabel(): string | null {
    if (!(flags.gunShop && flags.vitalsPickups) || dead || armour >= MAX_ARMOUR) return null;
    const current = deps.getCurrentCents?.() ?? null, stage = armourPriceCents(deps.getStage?.() ?? 0);
    return '$' + (Number(current === null ? stage : cappedShopPrice(stage, current)) / 100).toLocaleString('en-US', { maximumFractionDigits: 0 });
  }
  /** Buy a full vest (server-priced, idempotent per request id; the server grants it and sends COMBAT_VITALS). */
  async function buyArmour(): Promise<void> {
    if (armourLabel() === null) return;
    const requestId = crypto.randomUUID();
    const allowDownRound = confirmedDownRound('armour');
    downRoundArmed = null;
    for (let attempt = 0; attempt < 2; attempt++) { // one retry of the SAME request id: never charges twice
      try {
        const res = await fetch('/api/funding/buy-armour', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
          body: JSON.stringify({ requestId, sid: deps.getSid?.(), allowDownRound }) });
        const data = await res.json().catch(() => ({})) as { status?: string; currentCents?: string; error?: string; round?: string; priceCents?: string };
        if (data.error === 'down-round') { armDownRound('armour', 'body armour', data); return; }
        if (data.error === 'not-at-shop') { shopNotice('Body armour is sold at the corner stores: head for a green $ on the radar.'); return; }
        if (res.ok && data.status === 'bought') {
          deps.onEvent?.('gun_buy', 'armour');
          if (typeof data.currentCents === 'string') deps.onValuation?.(data.currentCents);
          shopNotice('Bought body armour.');
        } else if (res.ok && data.status === 'full') shopNotice('Your armour is already full.');
        else shopNotice(data.error === 'unaffordable' ? "You can't afford body armour yet." : "Couldn't buy body armour.");
        wheel?.refresh();
        return;
      } catch { if (attempt === 1) shopNotice("Couldn't buy body armour."); }
    }
  }

  /** Gate (fire rate + ammo + reload) and spend a round. Called by the fire system; true if a shot fires. */
  function tryFire(now: number): boolean {
    if (dead || !started || !flags.weapons) return false;
    // driveBy: no fists/bat out of a car window — switch to the best gun you own (or don't fire).
    if (inVehicleNow() && WEAPONS[currentWeapon].melee) {
      const gun = (['rifle', 'smg', 'pistol'] as const).find(id => owned.has(id));
      if (!gun) return false;
      selectWeapon(gun);
    }
    const spec = WEAPONS[currentWeapon];
    if (now < reloadingUntil || !canFire(spec, lastFireMs, now)) return false;
    if (!spec.melee) {
      if (ammo[currentWeapon] <= 0) { reloadingUntil = now + spec.reloadMs; return false; } // empty → start reload
      ammo[currentWeapon] -= 1;
      if (ammo[currentWeapon] <= 0) reloadingUntil = now + spec.reloadMs; // emptied this shot → auto-reload
      wheel?.refresh();
    }
    lastFireMs = now;
    if (shootHint) { deps.onDismissNotice?.(shootHint); shootHint = undefined; } // they've worked out how to shoot
    return true;
  }

  const inVehicleNow = () => flags.driveBy && (deps.inVehicle?.() ?? false);
  const canAim = () => started && !dead && flags.weapons && ((deps.isOnFoot?.() ?? true) || inVehicleNow()) && !(deps.hasModal?.() ?? false);
  const isReloading = () => reloadingUntil > performance.now();

  /** Manual reload (R): refill the current weapon's magazine after reloadMs (no-op for melee / already full). */
  function reload(): void {
    if (dead || !started || !flags.weapons) return;
    const spec = WEAPONS[currentWeapon];
    if (spec.melee || isReloading() || ammo[currentWeapon] >= spec.magazine) return;
    reloadingUntil = performance.now() + spec.reloadMs;
    wheel?.refresh();
  }

  /** Bring combat online once the player has confirmed 18+: reveal the HUD and mount the weapon wheel + fire. */
  function startCombat(): void {
    started = true;
    intentCleanup?.(); // drop the pre-start Tab interceptor before the weapon wheel mounts its own
    deps.onCombatStart?.(); // tell the server this player opted into combat (COMBAT_READY → valid PvP target)
    hud.show();
    // Marks combat live so combat.css can hide the gold funding "Funded stars" (they'd clash with the red
    // wanted stars). Removed in destroy; never added on decline/pre-accept (startCombat only runs on accept).
    try { document.body.classList.add('gt-combat-live'); } catch { /* non-DOM */ }
    if (flags.savedLoadout && flags.gunShop && flags.weapons) void restoreLoadout();
    if (flags.weapons && !wheel) {
      wheel = createWeaponWheel({
        parent,
        isOwned: id => owned.has(id),
        getCurrent: () => currentWeapon,
        getAmmo: id => (WEAPONS[id].melee ? null : ammo[id]),
        onSelect: selectWeapon,
        isBlocked: () => deps.hasModal?.() ?? false,
        isReloading,
        onReload: reload,
        priceLabel: flags.gunShop ? priceLabel : undefined,
        onBuy: flags.gunShop ? id => void buyWeapon(id) : undefined,
        armourLabel: flags.gunShop && flags.vitalsPickups ? armourLabel : undefined,
        onBuyArmour: flags.gunShop && flags.vitalsPickups ? () => void buyArmour() : undefined,
      });
    }
    if (flags.weapons && deps.fire && !fire) {
      fire = createFireSystem({
        scene: deps.fire.scene,
        camera: deps.fire.camera,
        canvas: deps.fire.canvas,
        parent,
        currentSpec: () => (flags.weapons ? WEAPONS[currentWeapon] : null),
        tryFire,
        canAim,
        muzzleOrigin: deps.fire.muzzleOrigin,
        ignoreRoot: deps.fire.ignoreRoot,
        selfRoot: deps.fire.selfRoot,
        onShot: deps.fire.onShot,
        aimLook: deps.fire.aimLook,
        aimTargets: deps.fire.aimTargets,
        aimAt: deps.fire.aimAt,
        sendFire: flags.serverHits ? dir => deps.onServerFire?.(currentWeapon, dir) : undefined,
      });
    }
    refreshOptions?.();
    // Founder playtest ("can't seem to shoot"): say how, once per device, the moment combat goes live.
    if (flags.weapons) {
      let shown = false;
      try { shown = localStorage.getItem('gtasf.combatHint') === '1'; localStorage.setItem('gtasf.combatHint', '1'); } catch { /* private mode */ }
      if (!shown) {
        shootHint = matchMedia('(pointer: coarse)').matches ? 'Tap FIRE to shoot. Weapon chip = more guns.' : (flags.aimControls ? 'Click to aim · Click/F shoot · Right mouse aim · Z lock-on · Tab weapons.' : 'Click or F to shoot · Tab for weapons.');
        deps.onNotify?.(shootHint);
      }
    }
  }

  let gate: AgeGateHandle | undefined;
  let pendingAction: (() => void) | undefined; // a combat action waiting on the 18+ accept
  let intentCleanup: (() => void) | undefined;  // removes the pre-start input interceptor
  /** (Re)show the 18+ gate. Declining leaves the base game fully playable with combat hidden. */
  function openAgeGate(): void {
    if (gate?.isOpen()) return; // already asking — don't thrash the overlay on repeated combat intents
    gate?.destroy();
    deps.onEvent?.('gate_shown');
    gate = createAgeGate({
      parent,
      onAccept() {
        deps.onEvent?.('gate_accept');
        startCombat();
        const run = pendingAction; pendingAction = undefined;
        run?.(); // deliver the deferred action (give the picked-up weapon, open the wheel, …) now combat is live
      },
      onDecline(explicit) {
        // Combat stays uninitialised (no HUD/wheel/fire); the rest of the game is untouched.
        pendingAction = undefined;
        if (explicit) deps.onEvent?.('gate_decline');
        if (explicit) deps.onNotify?.('Combat hidden. Turn it on anytime from Game Options → Mature content.');
        refreshOptions?.();
      },
    });
  }

  /**
   * Combat-entry gate. The first time the player tries to do anything combat-y we open the 18+ gate (never on
   * load — that interrupted the founder funnel). Already confirmed → run `after` now; not yet chosen → defer it to
   * the accept; previously declined → createAgeGate resolves onDecline without showing anything (combat stays off).
   */
  function requestCombat(after?: () => void): boolean {
    if (started) { after?.(); return true; }
    if (after) pendingAction = after;
    openAgeGate();
    return false;
  }

  /**
   * Before combat is live there is no weapon wheel/fire system, so listen for the weapon-wheel key (Tab) and treat
   * it as a combat intent that opens the gate. Left-click is deliberately NOT intercepted — it is the game's
   * look/pointer-lock gesture; the other combat entries (weapon pickup, gun shop, robbery/heist) come through
   * requestCombat from main.ts. Removed once combat starts (the wheel then owns Tab) and on destroy.
   */
  function armCombatIntent(): void {
    const onKey = (e: KeyboardEvent) => {
      if (deps.hasModal?.() ?? false) return;
      if (e.code === 'Tab') { e.preventDefault(); requestCombat(() => wheel?.open()); }
      else if (e.code === 'KeyF' && !e.repeat && !typingTarget(e.target)) requestCombat(); // F = shoot: opens the 18+ gate first
    };
    // A left-click while the pointer is already LOCKED is a shot, not the look gesture: open the gate for it.
    const onPointer = (e: PointerEvent) => {
      if (e.button === 0 && e.pointerType === 'mouse' && document.pointerLockElement && !(deps.hasModal?.() ?? false)) requestCombat();
    };
    window.addEventListener('keydown', onKey);
    deps.fire?.canvas.addEventListener('pointerdown', onPointer);
    intentCleanup = () => { window.removeEventListener('keydown', onKey); deps.fire?.canvas.removeEventListener('pointerdown', onPointer); intentCleanup = undefined; };
  }

  // Game Options "Mature content" section (gore toggle + re-enable), built before the gate so its
  // onAccept/onDecline can refresh it. No-op when main.ts didn't supply the options panel.
  const refreshOptions = deps.optionsPanel ? buildMatureOptions(deps.optionsPanel, openAgeGate) : undefined;

  // Founder-funnel (2026-10-14): the 18+ gate must NOT pop on load — it was landing on top of the founder
  // ladder's "Found your startup" card for every new player. A returning player who already confirmed starts
  // combat straight away; everyone else stays dormant (unarmed, combat HUD hidden) until their FIRST combat
  // action opens the gate via requestCombat.
  if (isAgeAcknowledged()) startCombat();
  else { armCombatIntent(); refreshOptions?.(); }

  /**
   * Build the Game Options → Mature content controls and return a `refresh()`:
   *   • Blood & gore toggle (only once the player is past the 18+ gate and the gore subsystem is on).
   *   • "Enable mature content (18+)" button when the player hasn't accepted (declined or not yet chosen),
   *     which clears the stored choice and reopens the gate — so a decline is always reversible in-game.
   */
  function buildMatureOptions(panel: HTMLElement, openGate: () => void): () => void {
    const section = document.createElement('section');
    section.className = 'gt-game-options-combat';
    const heading = document.createElement('span');
    heading.className = 'gt-game-options-combat-label';
    heading.textContent = 'Mature content';

    const gore = document.createElement('button');
    gore.type = 'button';
    gore.addEventListener('click', () => { setGoreEnabled(!isGoreEnabled()); refresh(); });

    const enable = document.createElement('button');
    enable.type = 'button';
    enable.textContent = 'Enable mature content (18+)';
    enable.addEventListener('click', () => {
      // Close the Game Options modal first: it's a native <dialog> in the top layer, so the gate overlay
      // (a plain fixed div) would otherwise open behind it, invisible.
      const dialog = panel.closest('dialog');
      if (dialog instanceof HTMLDialogElement && dialog.open) dialog.close();
      resetAgeChoice(); openGate(); refresh();
    });

    section.append(heading, gore, enable);
    panel.append(section);

    function refresh(): void {
      const acknowledged = isAgeAcknowledged();
      // Gore toggle: live only when the subsystem is on AND the player is past the gate.
      gore.hidden = !(flags.gore && acknowledged);
      gore.textContent = `Blood & gore: ${isGoreEnabled() ? 'on' : 'off'}`;
      gore.setAttribute('aria-pressed', String(isGoreEnabled()));
      // Re-enable button: offer it whenever combat isn't live for this player.
      enable.hidden = acknowledged && started;
    }
    refresh();
    return refresh;
  }

  async function reportDeath(kind: DeathKind): Promise<void> {
    try {
      const incidentId = (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`);
      const res = await fetch('/api/combat/death', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ kind, incidentId }),
      });
      if (res.ok) {
        const data = await res.json() as { currentCents?: string };
        if (typeof data.currentCents === 'string') deps.onValuation?.(data.currentCents);
      }
    } catch {
      // Best effort: a failed debit must never trap the player. Respawn regardless; the idempotent
      // incident id means a future retry (not wired in v1) would be safe.
    }
  }

  async function kill(kind: DeathKind = 'wasted'): Promise<void> {
    if (dead) return;
    dead = true; lastDeath = kind;
    health = 0;
    hud.setHealth(0);
    const settled = reportDeath(kind);        // fire the money path alongside the screen fade
    await overlay.play(kind);                 // fully covered now
    await settled.catch(() => undefined);     // let the cost settle (or fail) before the world reappears
    deps.respawn();                           // main.ts moves the player to SF General
    health = MAX_HEALTH;
    armour = 0;
    hud.setHealth(health);
    hud.setArmour(armour);
    dead = false;
    overlay.dismiss();
  }

  function damage(amount: number): void {
    if (dead || !(amount > 0)) return;
    const toArmour = Math.min(armour, amount);
    armour -= toArmour;
    const rest = amount - toArmour;
    health = Math.max(0, health - rest);
    hud.setArmour(armour);
    hud.setHealth(health);
    if (health <= 0) void kill('wasted');
  }

  /**
   * A server-authoritative hit on THIS player (serverHits): the server owns health, so just reflect it on the
   * HUD. On a server kill, show WASTED but DON'T post /api/combat/death or respawn locally — the server already
   * applied the valuation cost (srv: incident) and CORRECTIONs us to SF General.
   */
  function serverHit(amount: number, killed: boolean): void {
    if (killed) {
      if (dead) return;
      dead = true; lastDeath = 'wasted'; health = 0; hud.setHealth(0);
      void (async () => {
        await overlay.play('wasted');
        health = MAX_HEALTH; armour = 0; hud.setHealth(health); hud.setArmour(armour);
        dead = false; overlay.dismiss();
      })();
    } else {
      health = Math.max(0, health - amount);
      hud.setHealth(health);
    }
  }

  /** Server-applied arrest: like a server kill, show the screen only — never post a second (client) debit. */
  function serverBusted(): void {
    if (dead) return;
    dead = true; lastDeath = 'busted';
    void (async () => {
      await overlay.play('busted');
      health = MAX_HEALTH; armour = 0; hud.setHealth(health); hud.setArmour(armour);
      dead = false; overlay.dismiss();
    })();
  }

  const combat: Combat = {
    get health() { return health; },
    get armour() { return armour; },
    get dead() { return dead; },
    get lastDeath() { return lastDeath; },
    get started() { return started; },
    damage,
    addArmour(amount: number) { if (amount > 0) { armour = Math.min(MAX_ARMOUR, armour + amount); hud.setArmour(armour); } },
    heal(amount: number) { if (!dead && amount > 0) { health = Math.min(MAX_HEALTH, health + amount); hud.setHealth(health); } },
    kill(kind: DeathKind = 'wasted') { void kill(kind); },
    serverHit,
    serverBusted,
    setVitals(h: number, a: number) { if (dead) return; health = Math.max(0, Math.min(MAX_HEALTH, h)); armour = Math.max(0, Math.min(MAX_ARMOUR, a)); hud.setHealth(health); hud.setArmour(armour); },
    setWanted(level: number) { hud.setWanted(level); },
    setEscaping(on: boolean) { hud.setEscaping(on); },
    setEscape(phase, progress, secondsLeft, hint) { hud.setEscape(phase, progress, secondsLeft, hint); },
    get weapon() { return currentWeapon; },
    get aimLocked() { return fire?.aimLocked ?? false; },
    selectWeapon,
    giveWeapon,
    requestCombat,
    update(dt: number) {
      if (reloadingUntil && performance.now() >= reloadingUntil) {
        const spec = WEAPONS[currentWeapon];
        if (!spec.melee) { ammo[currentWeapon] = spec.magazine; wheel?.refresh(); } // refill (auto-empty or manual R)
        reloadingUntil = 0;
      }
      fire?.update(dt);
    },
    destroy() { try { document.body.classList.remove('gt-combat-live'); } catch { /* non-DOM */ } intentCleanup?.(); gate?.destroy(); overlay.destroy(); hud.destroy(); wheel?.destroy(); fire?.destroy(); },
  };

  // Headless evidence hook (testingHarness only): lets a capture trigger WASTED/BUSTED and read state
  // without a weapon, so the death→respawn→valuation-cost flow is verifiable before combat has damage sources.
  if (flags.testingHarness) {
    (window as unknown as { __gtasfCombat?: unknown }).__gtasfCombat = {
      damage, kill: (k?: DeathKind) => combat.kill(k), serverHit, setWanted: (l: number) => hud.setWanted(l), addArmour: combat.addArmour, heal: combat.heal,
      selectWeapon, giveWeapon, buyWeapon: (id: WeaponId) => void buyWeapon(id), openWheel: () => wheel?.open(),
      requestCombat: () => requestCombat(), // open the (deferred) 18+ gate from a harness, then click Enter
      fire: () => fire?.triggerDown(), fireStop: () => fire?.triggerUp(), reload,
      state: () => ({ health, armour, dead, started, weapon: currentWeapon, owned: [...owned], ammo: { ...ammo }, reloading: reloadingUntil > performance.now() }),
    };
  }

  return combat;
}
