# Streamed tunnel contact

`world.collides` combines the existing building footprint index with a bounded
triangle index for decoded `structures` / `structures_*` meshes. The map's
existing `mapStreaming` flag guards this entry point. No new map artifact,
graph or inferred tunnel envelope is introduced.

The index reads normalized attributes through Three.js getters and applies the
complete world matrix, including GLB quantization scale and chunk translation.
Paired triangle windings are deduplicated. An 8 m XZ grid bounds vertical capsule
queries; Y bounds retain the distinction between the bore and upper ground.
The same query reaches walking, driving and the existing camera sphere sweep.
It mounts with the chunk, before incremental geometry reveal, and is removed
on unload/disposal. Portals are open because the rendered shell has no end caps.
Capsules with radius greater than half their requested height conservatively
extend their vertical bounds; normal avatar and camera callers do not do this.

Source evidence, 2026-10-03:

- `npx vitest run web/src/render/chunks/structureCollision.test.ts --maxWorkers 1`
  passed its one smoke: transformed INT16 geometry, walls, graded roof, open
  portals, both-direction driving, camera containment/recenter and unload.
- `npx tsc --noEmit -p web/tsconfig.json` passed.
- `npx tsx tools/tunnel-collision-smoke.mts` decoded nine actual SF chunks and
  checked 40 views along Broadway lane `lane:1k8m`: five positions, both headings,
  sideways orbit, steep look and recenter. All remain below the 4.5 m sourced
  ceiling. The 4,840 unique triangles occupy 272 cells;
  the report records exact artifact hashes at
  `artifacts/tunnel-collision/roof-view/source-report.json` (using that output
  through `GTASF_TUNNEL_EVIDENCE`).

Native baseline `artifacts/tunnel-native/2026-10-03T1137/` used immutable app
`37cb3e5` and SF manifest `dc90ea7c…`: desktop in both directions and a low-detail
phone view had no console/HTTP/map errors. Keyboard walking, ordinary orbit and
recenter stayed inside the bore. However, both steep keyboard views shortened
the boom enough to fade the avatar to zero. Those screenshots failed readability;
the bead remained open despite the other native assertions passing.

`ThirdPersonCamera.fitUnderRoof` now probes an actual overhead obstruction when a
requested long boom is pulled into the avatar fade range. It tries at most four
shallower pitches along the same yaw, accepting only a longer view that passes
the existing full sphere, ground and avatar-body clearance check. It keeps the
requested orbit so that leaving the roof restores it. Deliberate close zooms,
the fade constants and ordinary wall pull-in are unchanged.

The updated existing smoke plus four camera regressions pass, as does strict
web TypeScript. The exact-GLB source smoke now covers 40 views, including the
approximately 0.34 rad sideways angle in the native keyboard trace. Every view
stays under the roof with opacity above 0.2 (minimum 0.28175); both real driving
controller traversals cover 589.95 m through the open Broadway portals. Evidence
is `artifacts/tunnel-collision/roof-view/source-report.json`. The native helper
requires visible coverage for the steep view too.

Final native review passed at 12:05 UTC on 2026-10-03 using immutable common app
`fbecd8c80ffdd52e2eb06876eaa8e8938b5b06fb` from
`artifacts/founder-path/2026-10-03T1203/app`, local Worker `c8a7bdc`, SF manifest
`dc90ea7c05e411cfff1bdced2a31ce27add2dd35bb8e8a373375dba36c33603d` and unchanged
road graph `5763c53debed013a7f5403a467bd829f45dacfdfb83dc9c5c19e5555fe91651f`.
The report and all 11 personally reviewed screenshots are in
`artifacts/tunnel-native/2026-10-03T1204/`:

- Both 1100×720 desktop headings: default, physical keyboard orbit, steep look,
  C/recenter and physical walking. The camera stays inside the rendered bore;
  both walking checks advance more than 2 m along its source grade.
- Both steep views now show the avatar. The east view retains the ordinary
  near-wall translucency (opacity 0.28175, versus zero in the failed baseline);
  the west steep view and both recentered views have opacity 1. The camera's
  requested steep pitch remains preserved for leaving the tunnel.
- The 390×844 low-detail phone view shows the complete opaque avatar and bore.
- Console, HTTP and map error lists are empty in all three cases. The browser
  uses normal wall time, real onboarding and public location links; no pose
  override, fixed-step capture, above-ground teleport or cliff-limit exception.

This accepts the scoped local tunnel collision and camera behavior. It does not
establish the city visual, performance, real-device or deployment gates. The
native browser and preview were closed before releasing the shared GPU slot.
