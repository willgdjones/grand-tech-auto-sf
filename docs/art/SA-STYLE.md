# GTA San Andreas look: style guide for GTASF

These notes come from 31 original PS2, Xbox and PC screenshots of San Andreas, stored locally in `tools/art/reference/` (gitignored; Rockstar's copyright).
- Use them only to compare by eye.
- **Never** commit them, ship them, or feed them to Scenario as image inputs. Describe the style in words instead.
- The target is "somewhat like SA", not high fidelity.

## What makes it read as SA
1. **The sky tints everything.** Each time of day has a strong colour grade:
   - Clear midday: a flat saturated cyan-blue sky with bright, slightly washed-out ground.
   - Golden hour and sunset: amber to orange, and the *whole scene* goes orange, buildings and characters included.
   - Night: deep blue or purple ambient light, with warm sodium street lamps and neon.

   Drive our grade from the real SF clock: SF mornings and afternoons have cool fog-grey grades with Karl the Fog, and golden hour is orange.
2. **Heavy haze, short draw distance.** Distant buildings and hills fade into a fog that matches the sky colour. Hills become flat silhouettes. That fog is half of the look, so don't push the draw distance out.
3. **Low-res photo-sourced textures with visible tiling:** brick, stucco, cobbles, worn asphalt, corrugated metal. They're chunky, not smoothed. No PBR shine, except an occasional crude environment-map gleam on car paint and chrome.
4. **Baked, flat lighting.** Vertex-lit, with dark undersides and soft round blob shadows under cars and people. There are almost no real cast shadows.
5. **The streets carry the look:**
   - Worn asphalt with double-yellow centre lines; light concrete sidewalks with kerbs.
   - **Wooden telephone poles with sagging power lines across streets.** This is the most SA-specific detail of all, and SF has plenty of overhead Muni wires.
   - Mast-arm traffic lights, hydrants, chain-link fences, billboards everywhere, parody brand signage.
   - Palm trees and other trees as crossed alpha cards.
6. **Vehicles and people:** boxy 70s–90s cars with chunky chrome bumpers. Characters are low-poly with painted-on detail.
7. **The HUD:**
   - Top right: a white clock, a green money counter with leading zeros (e.g. `$03863103`, reused for our FUNDING display), a red health bar and the wanted stars.
   - Bottom left: the circular radar.
   - The font is pricedown-style for big titles and thin white text for subtitles.
8. **The camera:** low chase camera, slightly wide FOV, often angled so the sky fills the top third. This shows off the grade.

## What to do in GTASF
- Use a sky gradient and fog colour that change with the real SF time; the haze matches the sky colour.
- Grade by time of day: cyan midday, fog grey, golden-hour orange, blue-purple night with warm lamps.
- Apply the facade atlas (already good) at low resolution, tiled per floor, with a darker band of shopfronts at street level.
- Roads: asphalt plus double-yellow lines; sidewalks with kerbs.
- Props as cheap instanced meshes:
  - **utility poles and power lines, plus Muni overhead wires on the main streets**,
  - mast-arm traffic lights, hydrants, newspaper boxes, palm and plane trees as alpha cards, billboards.
- Blob shadows under cars and players. Turn off expensive shadow maps on mobile.
- Keep the HUD in the SA style: a FUNDING counter with leading zeros in SA money green, and stars.
- **Loading screens:** SA's are illustrated, poster-like art with bold ink outlines, comic shading, a limited saturated palette and character silhouettes against landmarks. Ours should do the same with SF landmarks and founder parody characters, using no real people.
