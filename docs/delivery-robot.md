# Ferry plaza delivery robot

PLAN lists delivery robots among the SF hazards. The `delivery-robot` flavour
record previously had no visible game entry. This local addition uses the existing
`hazards` switch and city-life mount: Game options → Find the delivery robot sets
directions to a pickup spot on the Ferry plaza.

The courier is parked. Its six wheels, chamfered cream cargo shell, dark bumpers,
vents, panel seams, reflectors, pickup label and orange safety pennant are original
GTASF geometry and artwork. A 256×128 sRGB canvas supplies the fictional label
(0.033 MP). No brand, external service, sample, font file or borrowed image is used.
Only the pennant and waiting light animate, within 30 metres. The entire prop culls
at 100 metres. It makes no claim to simulate a server-controlled delivery vehicle.

The fixed 1.16×1.44 metre collision footprint sits away from the central plaza
crossing, at Ferry-local (-16, 67). The existing on-foot and vehicle contact system
handles it; walking around restores progress without damage, payment or a reset.
The source landmark supplies its ground and rotation. Nearby flavour text asks
players to leave room. Disposal removes only this instance's footprint and frees
its meshes, material and canvas texture with the rest of city life.

The actual run at `artifacts/city-life/courier-1133/report.json` used immutable
client `37cb3e5`, native Worker `1d0a63b` and the sourced SF map. Normal startup
and Game options produced a 218.55-metre route with 48 points. Real keyboard
walking stopped at Ferry-local z=68.034 against the courier's body, then walked
around its west side and reached the other side without damage or reset. Console
and HTTP errors were empty. Strict web TypeScript and harness syntax pass.

The original front-facing images are retained; the avatar hid too much of the
cargo body. The final `artifacts/city-life/courier-1208/report.json` repeats normal
startup, real directions, the blocked approach and walk-around on immutable
client `fbecd8c` and native Worker `c8a7bdc`. It passes with no browser or HTTP
errors. Walking stops at local z=68.021, then clears the west side and reaches
z=64.5. A real three-quarter camera position now shows the cream cargo shell,
panel detail, three wheels along its side and orange pennant, particularly
clearly in the phone view. Both desktop and 390-pixel phone images passed review.
This completes gtasf-kr8v local acceptance. The broader C09 hazards, server-driven
delivery, performance and device gates remain separate.
