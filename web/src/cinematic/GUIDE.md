# Cinematic capture

Explicit cinematic mode directs the mounted city with an offline actor. It uses
the same source roads, heights, CC0 cars, landmarks and render pipeline as play.
It does not steer a server taxi or award funding. Normal multiplayer continues
to use the normal game loop when no `cinematic` query is present.

Enable `cinematicCapture` and `testingHarness` in `shared/flags.ts` after the
main loop wiring is present. `robotaxi` and `driving` enable the two car assets;
`mapStreaming`, `terrain`, `landmarks`, and the event snapshot/live API supply
the city. Incomplete external integrations stay disabled.

Available rails:

| Query | Shot | Default length |
| --- | --- | --- |
| `cinematic=lombard` | Chase a robotaxi down the source-road switchbacks | 42s |
| `cinematic=ferry` | Plaza-to-clock-tower flyover | 16s |
| `cinematic=salesforce` | Rising orbit revealing the tower crown | 16s |
| `cinematic=event` | GPS drive to a real Tech Week event | 20s |

Use `?capture=1&cinematic=lombard&fps=30&hud=0&preset=high`. `hud=0` hides
all chrome while retaining the event's in-world GPS ribbon/beam. Omit it to
show the directing label. `duration=2..120` changes a rail's length, and
`event=<id>` chooses another event with a public location and source-road route.
The default event is CodeRabbit's **Rabbits on the Run**, a real local calendar
entry whose pin is an approximate public area. A recording preserves that
qualification in its metadata. For long event trips, the rail shows the last
220m of the approach. Missing routes/events fail visibly.

Landmarks retain their real world anchors even when their base lies beyond
the current streamed ground corridor. In that case the rail loads the nearest
mapped neighbourhood and reports `groundAtSubject:false`; it does not invent
terrain or claim the city map has expanded. Salesforce currently uses this
case. A driving rail must stay on available ground and fails if it leaves it.

The existing `window.__gtasf.step(1)` advances exactly `1/fps` seconds. Before
each step, the optional harness preparation hook awaits the rail's streamed
3×3 map neighbourhood and queued meshes. Waiting does not advance simulation
time. Vehicle, camera and GPS animation use this clock. Without `capture=1`,
the rail previews in real time; recording uses the fixed clock exclusively.

Start the ordinary local server with `npm run dev`. Install `ffmpeg` and
`ffprobe` on PATH, then run one recorder at a time on the shared laptop:

```sh
nice -n 10 node tools/capture-cinematic.mjs --path lombard --framing portrait
nice -n 10 node tools/capture-cinematic.mjs --path ferry,salesforce,event --framing landscape --fps 30
```

`--framing portrait,landscape` records both 1080×1920 and 1920×1080. The high
quality tier keeps a native 2.07MP drawing buffer within its existing 2.1MP
budget. The recorder defaults to headed Chromium for hardware rendering;
`GTASF_HEADLESS=1` explicitly permits software rendering. `--url`, `--event`,
`--duration`, `--hud`, `--out` and `--fps` are optional. Existing MP4 files are
never overwritten. Export is silent H.264 MP4, with a JSON report and three
review frames per clip. Console errors, reloads, missing rails, encoder errors,
and unexpected output dimensions/frame counts fail the run.

In the shared checkout, add `--snapshot 1` to make one scoped web build under
the output directory and record from its temporary static preview. This
prevents another pane's edits from reloading an in-progress clip. The preview
closes after recording and proxies the event API to the running local Worker
on port8787. Coordinate that one build/browser slot with the other panes.

Integration: await `createCinematic({scene,world,landmarks,enabled:flags.cinematicCapture})`;
Pass the mounted landmark group so actor and GPS ribbon heights include the
same authored plaza/deck surfaces as normal driving.
When non-null, avoid starting the multiplayer/player simulation, call
`cinematic.update(dt, seconds)` and render `cinematic.camera`. Pass
`prepare: (_dt, now) => cinematic.prepare(now / 1000)` to `harness.run`, and
expose `world.cinematic` for the recorder. Forward resize and disposal. The
initial frame is prepared by the constructor. This footage is a directed
capture, and is never evidence of live performance or device acceptance.
