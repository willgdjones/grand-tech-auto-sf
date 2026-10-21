# On-foot avatar (gtasf-1h3)

`loadAvatarTemplate()` loads the CC0 Quaternius hoodie only when `flags.onFoot`
is enabled. Load once, then create an instance for each player. Instances share
geometry and clips but own their skeleton, mixer and materials. Call
`instance.update(dt, 'idle' | 'walk' | 'run' | 'sit' | 'drive', opacity)` each frame; state
changes crossfade over 180 ms. `dispose()` removes the instance and frees only
its private data. Dispose the template at scene shutdown to release shared data.

The manifest identifies the four clips. The sitting clip is authored for GTASF;
the rig and other clips are Quaternius originals. All licences and source links
are in `web/public/assets/LICENSES.md`. Assets contain no external textures.

The existing BDTS chase camera retains user-gesture pointer lock, drag fallback,
zoom and safe boom release. `camera/boxCollision.ts` supplies conservative swept
sphere collisions against scene bounds. The camera's `safe` result must be
respected before rendering; its `avatarOpacity` fades the local actor near walls.

Scoped verification:

```sh
nice -n 10 npx vitest run web/src/assets/manifest.test.ts web/src/avatar/riggedAvatar.test.ts web/src/camera/thirdPerson.test.ts --maxWorkers=1
nice -n 10 npx tsc --noEmit -p web/tsconfig.json
```

These checks decode the actual shipped GLBs, evaluate all four skin poses,
exercise independent players/disposal and test camera collision/recovery. They
do not establish deployed G1 or device-performance acceptance.

Local built-app smoke on 2026-10-03: the rigged avatar was visually checked in
idle/walk/run; walking changed 14.9% of screenshot channels and fallback dragging
changed 43.9%, with no page errors. The avatar GLB loaded once (HTTP 200), with no
pointer capture before a gesture. Headless Chromium refused capture after the
click and the drag fallback worked. Native capture success remains a manual
playtest check. The smoke intentionally has no backend and makes no multiplayer
acceptance claim. Evidence is in ignored `artifacts/gtasf-1h3/`.

Reproduce the short smoke after a web-only build with `node tools/avatar-check.mjs`
(install `tools/assets` dependencies first). The founder's playable-v1 priority
defers further property/performance/golden checks until after the playtest.

## Character polish (gtasf-xsfw)

`characterPolish` adds flat diffuse clothing/skin shading, an adult 1.82 m
silhouette, four hoodie palettes and a soft contact shadow without shadow maps.
`avatarOutfits` exports the display labels. `createInstance(outfitIndex)` selects
the initial palette; `instance.setOutfit(index)` changes only that player's
private clothing materials, and `instance.outfit` returns the selected index.
Geometry, skin tone and existing animation ownership stay shared/independent as
before. The local outfit control persists its index; remote colours can be seeded
from their player ID without adding network traffic.

`update(dt, 'drive')` uses a GTASF-authored wheel-reaching arm pose derived from
the seated clip, retaining its seated legs and subtle breathing. Use `drive` for
the driver and `sit` for passengers. The contact shadow is hidden in either seat
pose. No external avatar asset or copyrighted game art is introduced. Disabling
`characterPolish` restores the original materials/proportions and removes the
shadow; existing idle/walk/run/sit remain available.

In the mounted game, press **O** to cycle outfits or open **Game options** and
use the **Outfit** button, including on phones. The local choice is saved in
`gtasf.outfit`; if browser storage is unavailable it still works for that visit.
Global outfit shortcuts are suppressed while a modal is open. Remote characters
currently use their player ID's palette; the local outfit choice is not sent
through the multiplayer protocol.

Native city-game proof on 2026-10-03 at 10:48 UTC passed all 12 steps in
`artifacts/character-vehicle-polish/2026-10-03T1048/` using common1046 (`5315157`)
and the live local Worker. Reviewed desktop idle, all four outfits, walk, run,
seated-driver and phone images show the finished rig with opacity 1 at the
normal 8.5 m camera boom. Observed walk/run speeds were 3/6 m/s, and the contact
shadow returned after leaving the car. Keyboard O and the phone Outfit button
worked; open modals suppressed global outfit/recovery shortcuts. Browser, HTTP
and map error lists were empty. The earlier camera-obscured 10:04 images remain
separate and were not used to accept appearance. This completes local polish
evidence without claiming the deployed G1 or device-performance gates.
