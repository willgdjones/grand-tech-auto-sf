# City renderer

`flags.ps2Render` enables the B01 foundation at `createRenderFoundation({ canvas })`.
It owns the renderer, sky, lights, haze and bounded bloom targets. Disabling the flag
uses the ordinary scene renderer without the style conversion, fog or post passes.
Call `resize(cssWidth, cssHeight, devicePixelRatio)` on viewport changes, update the
camera's aspect separately, and call `render(camera)` once per frame.

`mountGeometry(root)` accepts a detached, loaded GLB scene. Apply the map's chunk
origin first: `(chunk.x * 256, 0, chunk.z * 256)`. Quantized node transforms and
linear `COLOR_0` attributes are preserved. Static materials become flat Lambert
materials; billboard shaders are retained. The returned release callback restores
borrowed materials and removes the root. The chunk owner then disposes its geometry,
original materials and textures. Streaming/worker decode/LOD admission are B02.

Hex sky colours enter Three as sRGB and are converted by `Color` once. Vertex
colours and intermediate buffers stay linear; only the final output converts to
sRGB. Fog shares the sky's horizon colour. Haze becomes opaque before the far clip
plane, and the sky follows the camera without a visible dome edge.

Bloom uses two quarter-resolution RGBA8 targets and a strength of 0.06. The composite
uses remaining highlight headroom and protects dark text. No full-resolution blur
chain, exposure boost or tone mapper is applied to ads. `render(camera, false)` is
the same colour path with bloom disabled, useful for comparing readability.
`createCreativeTexture` rejects decoded images above 1,048,576 pixels. This is a
creative limit; existing larger atlas pages retain their separate memory budget.

Verification (Node 24.21.0; short-lived, no watchers):

```sh
nice -n 10 npx vitest run web/src/render/foundation.test.ts web/src/render/screens/screenMesh.test.ts --maxWorkers=1
nice -n 10 npx tsc --noEmit -p web/tsconfig.json
nice -n 10 node tools/render-check.mjs --map tools/map/out/lombard
```

The isolated GPU entry is never imported by the application. It checks actual
white/grey/black/primary-colour pixels, fog, bloom contrast and DPR budgets on
desktop and a mobile viewport. With `--map`, missing real data is an error; it
mounts sourced Lombard GLBs and records screenshots plus evidence under ignored
`artifacts/render-foundation/`. These are render checks, not a physical iPhone
performance result or a G1 pass.

BDTS failed-feel lessons applied here: keep sky values in the correct colour space,
protect ad text from bloom, retain the decoded-image cap, and inspect real map
geometry rather than treating the bootstrap street as recognizable San Francisco.
The existing main scene remains explicitly labelled as a bootstrap fixture until
the B02 streaming integration replaces it.
