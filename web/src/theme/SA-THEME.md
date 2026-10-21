# GTASF San Andreas HUD/UI theme (gtasf-v2-sa-hud-theme)

Founder feedback: the UI "feels like Claude design", not GTA San Andreas. This is the **one shared SA
theme** every pane's UI adopts so the whole HUD reads as SA. Owner: SwiftBay; **all panes adopt**.

## SA rules (what to change)
- **No** rounded cream/dark-green panels, **no** serif/italic type, **no** soft drop shadows, **no**
  `border-radius` on HUD chrome.
- Text is drawn straight on screen with a **thick black outline** (`-webkit-text-stroke` + `paint-order:
  stroke fill`, or the canvas helper), solid fill, no blur.
- Big titles / mission-pass toasts: condensed **display** font, SA **gold/orange**, uppercase.
- Small text: plain **sans** with a black outline.
- Money (FUNDING counter): dark green `#345f27` + black outline + **leading zeros**; negative red `#a2191c`.
- Status bars: red `#b81d21` / white `#e3e3e3` / light blue `#b2cef2`.
- Stage stars (wanted-style): gold `#f0b429` glyph + black outline.
- Panels/dialogs: SA pause-menu — a **flat black translucent box** (square corners), white/blue menu text.
- Clock: big blocky light-grey `#dcdcdc` digits, top-right.

No pricedown font is bundled (licensing); the display stack is a condensed-bold fallback.

## How to adopt
1. **Import the tokens once** near the app entry (pane 1 / `web/src/main.ts`): `import './theme/saTheme.css';`
   so every pane gets the `--sa-*` custom properties. (Individual CSS files may also `@import` it or rely
   on the global import; tokens have inline fallbacks.)
2. **DOM UI** — use the tokens and utility classes from `saTheme.css`:
   - `.sa-panel` / `.sa-panel--strong` for dialogs/menus (replaces rounded cream/green boxes).
   - `.sa-title` (+`--orange`) for big titles/toasts; `.sa-text` for body text; `.sa-money` (+`--neg`),
     `.sa-clock`, `.sa-street`, `.sa-stars`/`.sa-star`, `.sa-bar`/`.sa-bar__fill`.
   - Or just use the tokens directly: `color:var(--sa-title-gold);-webkit-text-stroke:3px var(--sa-ink);paint-order:stroke fill`.
3. **Canvas HUD** (radar, world markers, floating labels) — use `web/src/theme/saText.ts`:
   - `drawOutlinedText(ctx, text, x, y, { font, fill, outline, lineWidth, align, baseline })` — thick black
     outline under a solid fill.
   - `SA_COLORS`, `SA_FONTS` (use `SA_FONTS.display` for blocky text), `saMoneyCents`/`saMoneyDollars`
     (leading-zero SA money), `saStars(filled,total)`.

## Reference implementation
`web/src/drops/` is migrated: `banner.css` (flat SA panel + gold outlined title + SA-money toast) and
`checkpoint.ts` (floating fund name via `drawOutlinedText`). Copy that pattern.

## Per-pane adoption (coordinate)
- **Pane 1 / HUD**: FUNDING counter → `.sa-money` leading zeros; clock → `.sa-clock`; stage → `.sa-stars`;
  import `saTheme.css` at entry; restyle `playableHud.css`, `toast.css`, buttons/panels.
- **Chat / nameplates / toasts**: `.sa-text` with outline for bubbles/nameplates; mission-pass toasts `.sa-title`.
- **Map / radar**: `drawOutlinedText` + `SA_COLORS` for labels; SA pause-menu look for the map panel.
- Other dialogs (game options, cap table, event submit, what's new, outbid, referrals): `.sa-panel` + SA text.

Reference art: `tools/art/reference/` (gitignored, compare by eye, **never commit**). Before/after via pane 6.
