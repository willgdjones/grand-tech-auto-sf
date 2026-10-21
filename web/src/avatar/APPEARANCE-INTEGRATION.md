# Appearance game integration — gtasf-hrmk.1 / gtasf-hrmk.2

`main.ts` connects the wardrobe and full avatar renderer through the existing
`characterLooks` flag. The source flag remains off. This change supplies the game
hooks; the parent appearance/renderer beads retain activation, in-game visual and
multiplayer acceptance.

When enabled, the initial avatar uses saved cosmetic choices before the funding
profile or WebSocket is available. `appearanceState.ts` stores the encoded
preferences at `gtasf.appearance.v1`, migrates valid `gtasf.outfit` preferences,
and keeps changes usable if storage is unavailable. It strips saved stage bits:
the current funding profile alone supplies the local round and look tier.
Cosmetic changes never change a funding amount.

The O action opens the wardrobe; phones use Game options → Wardrobe. The installed
`avatarLookChoices` catalogue exposes all eight outfit, hairstyle, hair-colour
and accessory variants. Apply persists and renders the selection, then broadcasts
the existing appearance message. Identity saves preserve those variants while
updating body/archetype. Funding updates apply the tier before the network early
return, refresh an open wardrobe, and announce a newly unlocked look through the
non-modal toast stack. The wardrobe is constructed after initial profile hydration
so returning players are not greeted with a false unlock.

The wardrobe participates in the movement/modal guard, releases held input, owns
a free-cursor lease, closes conflicting panels, and is hidden by other panel
handoffs and Escape. Page teardown disposes it and releases the cursor. With the
flag off, the existing four-palette outfit button and O-key cycling remain.

Remote APPEARANCE messages apply the entire decoded look to an existing avatar.
The same cached value initializes an avatar when its first pose arrives later.
The established PLAYER_LEAVE/WELCOME cleanup removes both avatars and cached
appearance. Personal rides retain their existing use of the round bits even
while character looks are disabled.

## Companion ground integration — gtasf-hrmk.2

The avatar template is wrapped by `withFounderStatus` after map and landmark
creation, before any local or remote instances are created. Its ground callback
uses authored landmark height first, then the map surface with the supplied
reference height. Authored decks and plazas also count as loaded ground.
Collision combines authored solids/rails with the existing map collision query.

Two cached landmark probes have distinct purposes: a null-base probe detects
authored height, while the collision probe retains real map contact at the Pier
39 quay exit. Using the null-base probe for that collision would incorrectly
block the last radius-width of the land-facing entrance. Neither probe is
created in the frame loop. They read live landmark visibility and transforms.

The same main-loop integration carries `gtasf-1cd6`'s tested
`resolveRobotaxiDestination` callback: the snapped lane height is supplied to the
surface sampler, preserving bridge/tunnel destinations and unloaded fallbacks.
No feature flags or protocol fields change.

## Verification

The focused `appearanceState.test.ts` smoke uses the shipped hoodie GLB and real
renderer. It covers preference migration/restoration, blocked storage, cosmetic
identity changes, authoritative round upgrades and downgrades, local rendering
before networking, and replaying encoded choices onto an independent peer rig.
The existing wardrobe component/native UI and renderer appearance receipts are
documented in [WARDROBE.md](WARDROBE.md) and [APPEARANCE.md](APPEARANCE.md).

The focused smoke passed on 2026-10-04 at 12:45:54 UTC (one test, 1.36 seconds),
followed by a clean strict web TypeScript check and successful web-only Vite build
to `/tmp/gtasf-hrmk1-web-20261004`. All three ran sequentially through
`tools/heavy.sh`, with one Vitest worker. The source hashes were unchanged through
the run. These are source/bundle checks; they do not establish the parent two-tab
game journey, desktop/phone look, device performance or deployment gate.

For `gtasf-hrmk.2`, the existing shipped-GLB founder-status smoke passed on
2026-10-04 at 13:53:21 UTC (one test, 294 ms), including loaded/blocked ground,
driving/dismount visibility and wrapper disposal. The destination helper's real
road-sampler/client/wire smoke is recorded with source commit `11ecd6a`.
The first web typecheck caught a concurrent onboarding fixture missing its new
`emailPrompts` field. After that separate repair, current web strict passed with
the 14:05 UTC check; the web-only bundle passed (319 modules, 1.81 s) at
`/tmp/gtasf-ground-recovery-20261004`.
The integrated main source hash is
`25719774745fd8bd3fecee3257c641224946571b8d2741477bc1b07d75677cf8`.
These checks validate the assembled source and module contract; the full-game
appearance runner must still verify actual landmark contact and the parent look
and multiplayer gates.

To enable, coordinate the shared client/Worker `characterLooks` flag after the
renderer review and the parent in-game acceptance. Companions and flyovers are
connected through the template wrapper; their full-game visual acceptance and
stage vehicles retain their separately tracked work. This
integration adds no assets, no funding endpoint and no protocol fields.
