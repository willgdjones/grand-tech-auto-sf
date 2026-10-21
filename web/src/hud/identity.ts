import { CO_ADJ, CO_NOUN, USER_ADJ, USER_NOUN } from '@gtasf/shared/startupNames';
import './identity.css';
import { flags } from '@gtasf/shared/flags';
import { FOUNDER_ARCHETYPES, type AvatarSex, type FounderArchetype } from '@gtasf/shared/content/cosmetics';
import { USERNAME_MAX, USERNAME_MIN, isValidUsername, normalizeUsername } from '@gtasf/shared/friends/username';

/**
 * Post-first-payout SA identity screen (PLAN-onboarding.md decision 4). One screen, shown AFTER the
 * Orientation cheque, asking for a globally-unique username, startup name, male/female and founder
 * archetype — with random defaults pre-filled so a player can just hit "Looks good". The recovery
 * code is offered straight after (via `onComplete`, which pane 14 wires to the recovery panel).
 *
 * Self-contained `<dialog>`: the host (pane 14) gates it on `flags.onboarding` and triggers it after
 * the first payout, replacing the up-front startup-name modal for new players. Username uniqueness
 * goes through `checkUsername` — pane 13's friends API when it lands; a permissive stub until then.
 */
export interface IdentityChoice {
  readonly username: string;
  readonly startupName: string;
  readonly sex: AvatarSex;
  readonly archetype: FounderArchetype;
}
export interface UsernameCheck { readonly available: boolean; readonly reason?: string }
export interface IdentityScreen {
  readonly element: HTMLElement;
  readonly isOpen: boolean;
  open(prefill?: Partial<IdentityChoice>): void;
  close(): void;
  destroy(): void;
}

const pick = <T>(a: readonly T[]): T => a[Math.floor(Math.random() * a.length)]!;

function randomChoice(): IdentityChoice {
  return {
    username: `${pick(USER_ADJ)}${pick(USER_NOUN)}${1000 + Math.floor(Math.random() * 9000)}`,
    startupName: `${pick(CO_ADJ)} ${pick(CO_NOUN)}`,
    sex: Math.random() < 0.5 ? 'male' : 'female',
    archetype: pick(FOUNDER_ARCHETYPES).id,
  };
}

/** Availability check used only when Friends is enabled. Network failure never blocks onboarding. */
async function defaultCheckUsername(username: string, signal: AbortSignal): Promise<UsernameCheck> {
  const res = await fetch(`/api/friends/search?u=${encodeURIComponent(username)}`, { credentials: 'same-origin', cache: 'no-store', signal });
  if (!res.ok) throw new Error(`search ${res.status}`);
  const data = (await res.json()) as { found?: boolean };
  return data.found ? { available: false, reason: 'taken' } : { available: true };
}

function node<K extends keyof HTMLElementTagNameMap>(tag: K, text = '', className = '') {
  const el = document.createElement(tag);
  if (text) el.textContent = text;
  if (className) el.className = className;
  return el;
}

export function createIdentityScreen(options: {
  onSave(choice: IdentityChoice): Promise<void> | void;
  checkUsername?(username: string, signal: AbortSignal): Promise<UsernameCheck>;
  onComplete?(choice: IdentityChoice): void;
  onModalChange?(open: boolean): void;
}): IdentityScreen {
  const dialog = node('dialog', '', 'gt-identity');
  dialog.setAttribute('aria-label', 'Create your founder');
  dialog.append(node('p', 'FOUNDER ID', 'gt-identity-eyebrow'), node('h2', 'Who are you?', 'gt-identity-title'));

  const form = node('form', '', 'gt-identity-form');
  const userRow = node('label', 'Username', 'gt-identity-field');
  const username = node('input', '', 'gt-identity-input') as HTMLInputElement;
  username.maxLength = 20; username.autocomplete = 'off'; username.spellcheck = false; username.setAttribute('aria-label', 'Username');
  const userState = node('span', '', 'gt-identity-check');
  userRow.append(username, userState);

  const startupRow = node('label', 'Startup', 'gt-identity-field');
  const startup = node('input', '', 'gt-identity-input') as HTMLInputElement;
  startup.maxLength = 48; startup.autocomplete = 'off'; startup.setAttribute('aria-label', 'Startup name');
  startupRow.append(startup);

  const sexRow = node('div', '', 'gt-identity-field');
  sexRow.append(node('span', 'Look', 'gt-identity-label'));
  const sexToggle = node('div', '', 'gt-identity-seg');
  const sexButtons: Record<AvatarSex, HTMLButtonElement> = {
    male: node('button', 'Male', 'gt-identity-seg-btn') as HTMLButtonElement,
    female: node('button', 'Female', 'gt-identity-seg-btn') as HTMLButtonElement,
  };
  sexButtons.male.type = sexButtons.female.type = 'button';
  sexToggle.append(sexButtons.male, sexButtons.female); sexRow.append(sexToggle);

  const archRow = node('label', 'Archetype', 'gt-identity-field');
  const archetype = node('select', '', 'gt-identity-input') as HTMLSelectElement;
  archetype.setAttribute('aria-label', 'Founder archetype');
  for (const a of FOUNDER_ARCHETYPES) { const opt = node('option', a.label) as HTMLOptionElement; opt.value = a.id; archetype.append(opt); }
  const archHint = node('span', '', 'gt-identity-archhint');
  archRow.append(archetype, archHint);

  const actions = node('div', '', 'gt-identity-actions');
  const reroll = node('button', '🎲 Shuffle', 'gt-identity-reroll'); reroll.type = 'button';
  const go = node('button', 'Looks good', 'gt-identity-go'); go.type = 'submit';
  actions.append(reroll, go);
  const status = node('p', '', 'gt-identity-status'); status.setAttribute('role', 'status');
  form.append(userRow, startupRow, sexRow, archRow, status, actions);
  dialog.append(form);
  document.body.append(dialog);

  let disposed = false, announced = false, sex: AvatarSex = 'male';
  let controller: AbortController | null = null, checkSeq = 0, usernameOk = false, checkTimer: ReturnType<typeof setTimeout> | undefined;

  function setSex(next: AvatarSex) {
    sex = next;
    sexButtons.male.setAttribute('aria-pressed', String(next === 'male'));
    sexButtons.female.setAttribute('aria-pressed', String(next === 'female'));
  }
  function refreshArchHint() {
    const a = FOUNDER_ARCHETYPES.find(v => v.id === archetype.value) ?? FOUNDER_ARCHETYPES[0]!;
    archHint.textContent = `${a.style} · ${a.prop}`;
  }
  function updateGo() { go.disabled = !usernameOk || startup.value.trim().length < 2; }

  function runCheck() {
    // Validate on pane 13's shared rules (gtasf-q4yo) so the client and worker agree exactly.
    const value = username.value.trim();
    usernameOk = false; updateGo();
    if (!isValidUsername(value)) { userState.textContent = value ? `✗ ${USERNAME_MIN}–${USERNAME_MAX} letters, numbers, _` : ''; userState.dataset.ok = 'false'; return; }
    const check = options.checkUsername ?? (flags.friends ? defaultCheckUsername : null);
    if (!check) {
      // The local funding identity remains usable while Friends is off. Do not request its disabled
      // endpoint or claim this name has been checked for global availability.
      usernameOk = true; userState.textContent = '✓ Ready'; userState.dataset.ok = 'true'; updateGo(); return;
    }
    userState.textContent = 'checking…'; userState.dataset.ok = '';
    const seq = ++checkSeq; controller?.abort(); controller = new AbortController();
    Promise.resolve(check(value, controller.signal)).then(
      result => {
        if (disposed || seq !== checkSeq) return;
        usernameOk = result.available;
        userState.textContent = result.available ? '✓ available' : `✗ ${result.reason ?? 'taken'}`;
        userState.dataset.ok = String(result.available); updateGo();
      },
      error => { if (disposed || seq !== checkSeq || (error as { name?: string })?.name === 'AbortError') return;
        // Offline/stub failure: allow it through rather than block onboarding.
        usernameOk = true; userState.textContent = '✓'; userState.dataset.ok = 'true'; updateGo(); },
    );
  }
  function scheduleCheck() { if (checkTimer !== undefined) clearTimeout(checkTimer); checkTimer = setTimeout(runCheck, 350); }

  function fill(choice: IdentityChoice) {
    username.value = choice.username; startup.value = choice.startupName; setSex(choice.sex);
    archetype.value = choice.archetype; refreshArchHint(); runCheck();
  }

  username.addEventListener('input', scheduleCheck);
  startup.addEventListener('input', updateGo);
  sexButtons.male.addEventListener('click', () => setSex('male'));
  sexButtons.female.addEventListener('click', () => setSex('female'));
  archetype.addEventListener('change', refreshArchHint);
  reroll.addEventListener('click', () => fill(randomChoice()));

  form.addEventListener('submit', event => {
    event.preventDefault();
    if (go.disabled) return;
    const norm = normalizeUsername(username.value);
    if (!norm) { status.textContent = `Username must be ${USERNAME_MIN}–${USERNAME_MAX} letters, numbers or _.`; return; }
    const choice: IdentityChoice = {
      username: norm.display, startupName: startup.value.trim(), sex, archetype: archetype.value as FounderArchetype,
    };
    go.disabled = true; status.textContent = 'Saving…';
    Promise.resolve(options.onSave(choice)).then(
      () => { if (disposed) return; status.textContent = ''; close(); options.onComplete?.(choice); },
      error => { if (disposed) return; status.textContent = (error as Error)?.message || 'Could not save — try again.'; go.disabled = false; },
    );
  });
  dialog.addEventListener('cancel', event => event.preventDefault()); // one-time screen: no Esc-dismiss

  function setModal(open: boolean) { if (open === announced) return; announced = open; options.onModalChange?.(open); }
  function open(prefill?: Partial<IdentityChoice>) {
    if (disposed) return;
    fill({ ...randomChoice(), ...prefill });
    if (!dialog.open) { setModal(true); dialog.showModal(); }
    username.focus({ preventScroll: true });
  }
  function close() { controller?.abort(); if (dialog.open) dialog.close(); setModal(false); }

  return {
    element: dialog,
    get isOpen() { return dialog.open; },
    open,
    close,
    destroy() {
      if (disposed) return; disposed = true; controller?.abort();
      if (checkTimer !== undefined) clearTimeout(checkTimer);
      if (dialog.open) dialog.close();
      dialog.remove();
    },
  };
}
