# GTASF: graphics polish of the SA look (background work, preview link first)

## Context
The game is soft-launched. The founder wants the graphics improved generally, as background work. Today's prod screenshots show:
- flat midday light and a plain sky;
- plain, untextured ground (lawns were partly fixed);
- box-like buildings outside downtown;
- pixelated tree foliage and sparse life.

The realistic renderer stays parked for later in the week.

Founder decisions (grilling):
- **Polish the existing SA look**, not the realistic path.
- **All four areas matter:** lighting/sky/atmosphere, ground and roads, buildings, trees/props/life.
- **Preview link first:** the founder plays a separate preview URL before approving anything for prod.
- **HD gets everything, Low stays fast:** heavy effects only on the HD preset; phones/Low get the cheap wins (grade, textures).

## Approach
All work goes behind a new flag **`graphicsV2`** (OFF in prod) with HD/Low tiers via `graphicsPreset()` (`web/src/render/graphicsPreset.ts`).

1. **Lighting, sky and atmosphere** (biggest perceived win, cheap):
   - SA colour grade: lifted blacks, warm desaturation, per-time tints (the existing bead `gtasf-v2-sa-colour-grade-a4fy`);
   - distance haze/fog that thickens toward the horizon;
   - a richer sky gradient and clouds with sun glow;
   - stronger golden-hour and dusk moods driven by the existing SF solar/NWS atmosphere (`saAtmosphere`, `sun`, `weather`);
   - HD only: soft sun shadows from the ps2 path's directional light, bloom tuned low (ads must stay readable).
2. **Ground and roads:**
   - use the fal-generated pavement/asphalt textures (`4b7b660`, HD) on Low too at a lower resolution;
   - textured sidewalks, plazas, parking, kerb/gutter and road wear with lane-paint decals;
   - no flat green except real parks; detail textures fade with distance; anisotropic filtering.
3. **Buildings:**
   - window/facade atlases and roof clutter (AC units, water tanks) for coarse outer-district boxes, with procedural variety by neighbourhood palette (reuse the district palettes and the Scenario facade modules from `realistic-facade-scenario-modules`);
   - ground-floor storefront bands everywhere;
   - LOD so far buildings stay cheap.
4. **Trees, props and life:**
   - fix pixelated foliage (alpha-to-coverage or alpha-test with mipmaps, higher-res leaf cards);
   - more street furniture density (benches, bins, lamps, hydrants);
   - more pedestrians on HD;
   - parked cars along streets (reuse the Ferry parked-fleet system, `ferryParkedCars`).
5. **Global cheap wins** (bead `gtasf-v2-render-cheap-wins-yjjz`): MSAA/FXAA on HD, devicePixelRatio cap tuning, texture anisotropy, mipmaps everywhere.

### Preview link (new tooling)
- Add a `--preview` mode to the deploy tool (tools/deploy) that builds ONLY the web client with `graphicsV2` forced ON and publishes it to a fixed Cloudflare Pages branch alias (e.g. `https://preview.gtasf.pages.dev`), still same-origin-routed to the existing production Worker.
- It **never** deploys the Worker, runs migrations or touches D1/R2.
- The orchestrator publishes previews only after an agent checkpoint, with before/after screenshots. Production stays unchanged until the founder approves.

## Owners (max 4 agents, low effort)
- **Claude on sub3, pane 0.2 (taste-heavy):** 1 lighting/sky/atmosphere and 3 buildings.
- **Codex, window codex2 pane 4:** 2 ground and roads, 4 trees/props/life, 5 cheap wins.
- **Codex, window codex2 pane 2:** the `--preview` deploy mode (small; verify it can't touch the Worker/D1), then help with props.
- Pause codex2.6 (trailer done).
- Coordinate on Agent Mail; each area lands in small slices behind `graphicsV2`.
- Unit tests only for the deploy tooling (it must not touch prod data); none for visuals.

## Verification
- Each checkpoint, the orchestrator publishes the preview, captures before/after screenshots (prod vs preview) at the Ferry, SoMa, Mission and Lombard at noon and golden hour, HD and Low, plus a phone viewport, and sends them to the founder.
- Watch the Low preset: no visible FPS regression on the phone check.
- Prod deploy of `graphicsV2` only on the founder's explicit go-ahead (soft-launch rule), with a D1 backup first and the deploy aborted if the backup fails.
