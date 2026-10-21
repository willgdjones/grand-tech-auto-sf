# Wardrobe integration — gtasf-looks-wardrobe-ui-7aby

`createWardrobe` returns `null` when `flags.characterLooks` is off. Otherwise it
creates a native modal and returns an unattached `launcher`, `show()`, `hide()`,
`refresh()`, `isOpen` and `dispose()`. The module does not install keyboard
listeners: route the existing `outfit` action to `show()` and append the launcher
to Game Options for phones. It handles secondary touch while another finger is
on the movement stick.

Supply `getAppearance()`, `getRound()`, `onChange(appearance)` and a `choices`
catalogue keyed by `outfit`, `hair`, `hairColor` and `accessory`. Each choice has
an encoded `index` (0–7), a displayed `label` and an optional minimum look `tier`
(default 0). Catalogues must describe supported rendering. The installed
`avatarLookChoices` catalogue now supplies eight variants for every row, through
the full body/archetype/stage renderer in `appearance.ts`.

Apply commits the selected eligible cosmetics. Cancel, Escape and a backdrop
click discard the draft. Apply checks the current round again and preserves the
latest sex, archetype, car and stage fields. No funding value is modified.

The main-loop wiring is implemented in `gtasf-hrmk.1`; see
[APPEARANCE-INTEGRATION.md](APPEARANCE-INTEGRATION.md) for persistence, round
authority and the remaining parent rollout gates. The integration:

- `onChange`: updates `localAppearance`, applies/persists all chosen cosmetics,
  calls `syncAppearance(true)` and refreshes Game Options.
- Includes `isOpen` in the modal guard. `onModalChange(open)` releases held
  input and coordinates the existing free-cursor/modal handoff. Other modal
  handoffs and the close action call `hide()`; teardown calls `dispose()`.
- Calls `refresh()` after a funding profile update. `onUnlock(tier)` fires once
  on an increase from the previously observed tier, showing the existing
  non-blocking SA toast with title `LOOK UNLOCKED` and the tier label as detail.
- Keeps existing outfit cycling as the flag-off fallback. Enabling the shared
  appearance flag still requires its coordinated client/Worker deployment.

The single focused native browser smoke bundles only the wardrobe and current
global/theme styles. Its enabled flag and small catalogue are explicit test
fixtures. It checks Apply/Cancel, changed eligibility, identity preservation,
unlock callbacks, Escape, focus, secondary touch, 44 px targets and a phone
viewport; screenshots and a report go under `artifacts/wardrobe-ui-7aby/`.
This is UI evidence, not complete game/renderer/device acceptance.

The smoke and web strict check passed on 2026-10-04 at 11:35 UTC. Desktop and
390×844 phone images were reviewed under
`artifacts/wardrobe-ui-7aby/2026-10-04T11-35-20.413Z/`: all six form controls are
44 px high, the phone panel stays within the viewport, and no horizontal
overflow or browser errors were recorded. An earlier harness failure came from
Playwright following an option's label to its enabled select; the corrected
check reads the native option's disabled state directly.

```sh
tools/heavy.sh sh -c 'npx vitest run web/src/avatar/wardrobe.test.ts --maxWorkers=1 && npx tsc --noEmit -p web/tsconfig.json'
```
