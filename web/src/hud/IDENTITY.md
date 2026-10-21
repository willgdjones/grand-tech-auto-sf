# Post-first-payout identity screen — integration contract (gtasf-8gbk)

SA-style one-screen founder creation shown **after the first payout** (PLAN-onboarding.md §4).
Self-contained component (`web/src/hud/identity.ts`); **pane 14 (onboarding owner)** gates + triggers
it. Replaces the up-front startup-name modal for new players.

## Module API
```ts
import { createIdentityScreen, type IdentityChoice } from './hud/identity';

const identity = flags.onboarding ? createIdentityScreen({
  onSave: async choice => { await funding.saveIdentity(choice.startupName, choice.username);
                            await friends.claimUsername(choice.username);   // pane 13
                            await cosmetics.save(choice.sex, choice.archetype); }, // pane 7
  checkUsername: (name, signal) => friends.usernameAvailable(name, signal),  // pane 13 (stub: resolves available)
  onComplete: () => recovery.offer(),                                        // show the recovery code
  onModalChange: open => setInputPaused(open),
}) : null;
```
Returns `{ element, isOpen, open(prefill?), close(), destroy() }`.

## Trigger (pane 14 flow controller)
Pane 14's `web/src/onboarding/flow.ts` drives it via `deps.ui.requestIdentity()` ("show the
post-first-payout identity screen; it calls `stepCleared('identity')` when done"). Wire its hooks to
this component (in main.ts / pane 6):
```ts
const identity = flags.onboarding ? createIdentityScreen({
  onSave: async c => { /* funding.saveIdentity + friends.claimUsername + cosmetics.save */ },
  // Omit to use the built-in default (GET /api/friends/search, pane 13 q4yo); override for a custom client.
  onComplete: () => { recovery.offer(); flow.stepCleared('identity'); },  // advance the tutorial
  onModalChange: setInputPaused,
}) : null;
// flow deps:
const onboardingUi = { /* … */ requestIdentity: () => identity?.open() };
```
Do **not** open the old up-front `fundingHud.openIdentity()` for new players when
`flags.onboarding` is on. For a skip/returning path with no tutorial, just call `identity?.open()`
after the first natural payout for an "Unnamed Founder" (random defaults pre-filled).

## Behaviour (built-in)
- Fields: **username** (globally unique, via `checkUsername`), **startup name**, **male/female**,
  **archetype** (pane 7's `FOUNDER_ARCHETYPES`). Random defaults pre-filled; a 🎲 Shuffle re-rolls.
- "Looks good" is enabled only when the username validates + is available and the startup name is ≥2
  chars. Username rule: 3–20 chars `[a-z0-9_-]`, lowercased.
- `checkUsername` is debounced (~350 ms, aborts stale checks). If it's absent or throws (offline /
  pane-13 not landed yet), the screen **fails open** so onboarding never blocks — pane 13 enforces
  uniqueness server-side on `claimUsername`.
- No Esc-dismiss (one-time screen). On save → `close()` → `onComplete(choice)` (recovery offer).

## Dependencies
- **pane 13 friends API (q4yo, shipped):** the default `checkUsername` calls `GET /api/friends/search?u=<name>`
  → `{found}`; `onSave` should claim via `POST /api/friends/username {username}`. If the friends flag is
  off the search 503s and the screen fails open (pane 13 enforces uniqueness on claim). Username
  validation uses the shared `shared/friends/username.ts` rules so client + server agree.
- **pane 7 cosmetics:** `FounderArchetype`/`AvatarSex` consumed directly from `shared/content/cosmetics.ts`.
- **recovery:** `onComplete` is where the recovery panel (`web/src/recovery/panel.ts`) is shown.
- Gated by `flags.onboarding` at the pane-14 call site (the component itself is flag-agnostic).
