# Street label layout

The street HUD keeps the sourced street and neighbourhood names behind the
existing `hud` switch. Its normal tall-desktop placement is the lower-right
corner; the phone layout remains owned by `phoneHud.css`.

At desktop widths above 700 px and heights up to 860 px, the street label uses
the space below the title. Its width leaves the full right toolbar and a 16 px
gap. This avoids the funding controls and optional radio ticker without moving
the label into the Events button below them. The sponsor bar offset is retained.
Street names still wrap in full, with the original type and animation.

The baseline game screenshot is
`artifacts/tunnel-native/2026-10-03T1204/east-desktop-default.png`, captured from
common app `fbecd8c`: at 1100×720, the `NOB HILL` label overlaps `Round perks`.

`node tools/street-hud-layout-smoke.mjs` mounts the production status, funding,
perks, street, Events and phone-menu constructors with their real CSS and the
game's toolbar/title markup. It checks the label's viewport bounds and separation
from those controls with radio text, long street names, sponsor offsets, compact
desktop widths, tall desktop and phones. It also checks that the visible funding
and Events buttons receive pointer input. This fixture has no world connection
or WebGL scene; it does not establish a native game, performance or device gate.

Scoped acceptance passed at 12:20 UTC on 2026-10-03:

- The fixture's Vite bundle and all eight DOM cases passed with empty console,
  page and HTTP error lists. Evidence: `artifacts/street-hud-layout/report.json`.
- All eight saved screenshots were personally reviewed. At 1100×720, Broadway
  occupies `(36,226)–(188.16,277.98)`, clear of the status column. Long names wrap
  in full at 1100, 800 and 701 px widths. Both sponsor states are clear.
- Tall 1365×900 desktop retains the lower-right label. The 390×844 and 320×844
  phone views retain their existing right-aligned placement, including radio
  text and a long street name. Visible funding and Events controls receive input.
- `npx tsc --noEmit -p web/tsconfig.json` passed. This is a CSS-only product
  change; no per-frame code, source-name lookup, flags or game state changed.

The eight screenshots verify this label's layout, not the entire HUD. The fixture
does not mount radar, touch movement, sponsor content or the 3D world; the native
baseline above establishes the original in-game overlap. The native phone/device
and wider visual gates retain their separate evidence requirements.
