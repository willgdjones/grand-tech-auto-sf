# CC0 model pipeline

Run from the repository root. This is a standalone tool package so asset work
does not mutate the shared workspace dependency manifest or lockfile.

```sh
npm ci --prefix tools/assets --ignore-scripts --no-audit --no-fund
node tools/assets/download.mjs
nice -n 10 node tools/assets/build.mjs
nice -n 10 node tools/assets/preview.mjs
```

An optional argument to download/build selects a different source cache directory.
Downloads are checksum-locked in `sources.json`; do not accept changed bytes
without checking the creator and licence. Raw packs stay in ignored `cache/`.
The Quaternius download is from the creator's public Poly Pizza listing because
its original Google Drive download was quota-limited.

`build.mjs` creates seven vehicle GLBs and one skinned avatar under
`web/public/assets`, with a provenance/size audit in `report.json`. It fails if any
vehicle reaches 300,000 bytes. The order is prune → dedup → resample → meshopt;
glTF Transform's meshopt transform itself runs reorder + quantize (14-bit
positions, 10-bit normals), then writes required EXT_meshopt_compression.
Applying another quantize pass would unnecessarily reduce precision.

Assets use metres, Y up, forward +Z (the current vehicle/player yaw convention),
with X/Z centred and feet/wheels at ground Y=0. World north remains -Z. Animated
avatar height varies slightly by pose; its unanimated bind mesh is 1.75 m.
`report.json` bounds are the static source/bind bounds before quantization;
animated skin bounds must be computed after the skeleton is evaluated.

Palette textures become **linear** vertex colours. Outputs contain no image
textures or external resources, so decoded-image allocation is zero. Vehicle
wheel nodes are preserved. Robotaxi has an independent `lidar` parent node whose
local Y rotation can be animated without rotating the chassis. The seated clip
is a GTASF-authored 2 s breathing loop using the Quaternius rig; it is not an
original Quaternius clip. It positions hips about 0.5 m above the actor's feet
origin, with knees forward and feet down, for subsequent seat attachment.

Use `web/src/assets/manifest.ts` and the meshopt-aware `loadModel` helper. The
avatar entry is enabled only through the `onFoot` flag. Sourcing vehicles does
not enable driving, robotaxi, traffic, Muni or cable-car features: their own
entry-point flags and acceptance beads control activation.

`preview.mjs` uses one short-lived static HTTP server and one headless browser,
then closes both. It saves a contact sheet and evaluated skin bounds to ignored
`artifacts/gtasf-1h3/`. This checks model appearance/decoding only; it is not a
deployed G1, device-performance, or playtest acceptance claim.

## Realistic Meshy fleet (`realisticRender`, gtasf-u9n0)

```sh
node tools/art/meshy.mjs balance                 # credits + ledger total (budget 1,500)
node tools/art/meshy.mjs gen robotaxi cab ...    # preview + PBR refine -> ignored cache/meshy/*.glb
nice -n 15 node tools/assets/build-meshy.mjs     # -> web/public/assets/vehicles-pbr + realisticVehicles.ts
```

`meshy.mjs` reads `MESHY_API_KEY` from ignored `tools/art/.env` (never print it) and logs
every task in `tools/art/meshy-ledger.json`. `build-meshy.mjs` bakes node transforms,
turns the long axis to Z, puts the lower (bonnet) end at +Z, scales existing assets to the
CC0 model's length (new ones to a real-world length), grounds at Y=0 and writes
`<asset>.glb` (HD: <=30k tris, 992 px WebP base/normal/metal-rough) and `<asset>.low.glb`
(Low: ~5k tris via permissive meshopt simplification across UV seams, 256 px base colour,
128 px metal-rough, no normal map, hard-fails at 300 KB). Meshy models are single meshes:
wheels do not spin and the robotaxi has no separate `lidar` rotor.
