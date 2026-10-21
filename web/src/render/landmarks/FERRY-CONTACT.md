# Ferry ground contact

`gtasf-r2mn` remains open. This document records the reproduced discrepancy;
the broad plaza mesh/contact repair has not landed.

Run `nice -n 10 node --import tsx tools/ferry-contact-check.mjs` at the agreed CPU
boundary. It reads the current placed Ferry factory, native actor coordinates,
SF manifest, packed graph, and the four overlapping emitted chunks. It verifies
their hashes, reconstructs the exact quantized road and terrain triangles at both LODs,
raycasts the authored Ferry ground mesh, and compares both with movement contact.
The emitted road triangles include driving and non-driving paths. Terrain is
cut out beneath roads by the map bake; the check records absent triangles as
absent instead of substituting a heightfield there. Heightfield movement contact
is recorded separately from emitted terrain. This offline
diagnosis is not native, frame-rate or real-device acceptance.

The 2026-10-03 13:58 UTC baseline in `artifacts/ferry-contact/baseline.json` matches
the factory transform to the saved common1337 native coordinates within
2.27e-13m. Across 303 current lane samples inside the broad authored plaza,
235 differ from flat plaza contact by more than 10cm and 16 by more than 35cm.
The maximum lane-height discrepancy is 36.6319cm. The maximum discrepancy from
actual visible ground is 36.4010cm at LOD0 and 36.6844cm at LOD1.

At local `(109.24, 60.85)`, contact is 3.2563m while the visible road is
3.6203/3.6232m, burying feet or wheels by about 36.5cm. At
`(-73.74, 78.61)`, the lane is 2.89m but the authored curb is 3.4763m.
Returning the road height alone would put an actor below the opaque curb.
The repair must make visible paving and movement contact agree, preserve real
road passage, and retain the hall, spawn and surrounding pedestrian fixtures.

The old `artifacts/ferry-pedestrians/road-contact-baseline.json` used an obsolete
Ferry transform and is invalid. It is retained only as a withdrawn receipt.

The probe also supports an explicit `GTASF_CONTACT_COFFEE_CANDIDATE` JSON object
with `cart`, `queue` and `yieldDistance`; this changes only offline sample
coordinates. Source placement and the running game are not modified. The
candidate cart at `(-40.5, 0.18, 21)`, with queue offsets
`[[0,2.2],[0.25,4],[-0.2,5.8],[0.7,-1.4]]` and a 1.15m yield sweep, passed
501 cart-grid and 0.35m-radius swept actor samples at both LODs on 2026-10-03
14:11 UTC. Maximum visible-contact difference was 2.0000004cm, the ordinary
authored paving clearance. The receipt is
`artifacts/ferry-contact/coffee-candidate21.json`. Traffic/path clearance,
actual fixture clearance and the fresh native coffee check remain separately
required by `gtasf-1blk`.

The 14:22 UTC recheck in `artifacts/ferry-contact/emitted-terrain-current.json`
uses the applied coffee source placement and includes emitted terrain triangles
at both LODs. All 501 coffee samples still differ by at most 2.0000004cm. The
303-sample roadway discrepancy is unchanged. This supersedes the earlier
heightfield-only terrain component without changing the road/paving findings.

`tools/ferry-plaza-mask.mjs` prepares an ignored source-derived road-mask
candidate. It checks the same native/current-factory correspondence and OSM
hash, includes both LOD ribbon constructions with a 5cm quantization allowance,
and keeps busways, cycleways and private roads. The 14:29 UTC candidate has 21
intersecting ways, two union-mask polygons and sixteen retained paving polygons.
The default spawn lies outside the mask by 3.212m, and every current pedestrian
route corner remains outside (minimum 0.878m after the extra allowance).
This is design evidence only; the running paving and contact are unchanged.

The underlying graph contact also differs from emitted roads, independently of
the broad slab. At lane `lane:pyp`, world `(1163.39,-1312.42)`, graph height is
3.07m while emitted road height is 2.955153/2.955094m. Falling back to graph
contact there would leave feet or wheels 11.49cm above the road. A scoped,
optional emitted-ground query is being prepared with the map owner; it must
respect decoded transforms, selected LOD, revealed geometry, vertical decks and
chunk eviction. Whole-city contact and tunnel/bridge behavior remain separate.
