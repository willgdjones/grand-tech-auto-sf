# Sky ads (blimp + banner planes)

Founder playtest feedback (gtasf-more-billboards-sky-ads-hyvs), the flying half of
"more billboards + sky ads". `createSkyAds({ low?, enabled? })` returns
`{ root, update(dt, now), destroy() }` or `null` when `flags.skyAds` is off. It is
net-new render code — there was no plane/blimp module before (only the `outbidPlane`
flag + a `plane-flyover` catalogue entry).

- **Craft** (`shared/content/skyAds.ts`, `SKY_AD_CRAFT`): one blimp looping over the
  Bay/FiDi and two banner planes along the Embarcadero and over SoMa. On `low` tier
  only the blimp renders, to protect the phone frame budget.
- **Flight**: each craft follows a horizontal ellipse (`ellipsePoint`), centre projected
  from lat/lon via `geodeticToWorld(…, SF_FRAME)`; heading faces the velocity
  (`headingFromVelocity`, local +Z = nose), with a gentle altitude bob. `update(dt, now)`
  clamps long frames so the path never jumps. The route math is pure and unit-tested
  (`skyAds.test.ts`); the three.js meshes are not.
- **Creatives**: original parody copy (`SKY_AD_CREATIVES`) drawn to a `CanvasTexture`
  banner (`MeshBasicMaterial`, `toneMapped:false`, no bloom/emissive — matches the SA
  budget). Low-poly hull/fuselage; banners are `DoubleSide` so readable from either side.
- **Sellable**: each craft is a presell slot (`slotId`, billed via the `plane-flyover`
  catalogue product). A *sold* creative + checkout stay gated behind the paid-ads flags
  and pane 7's ledger/Stripe, exactly like billboards — unsold shows the parody creative.
- **Lifecycle**: mounted with `foundation.mountGeometry(skyAds.root)` and ticked next to
  `parodyBillboards?.update` in both the normal and cinematic loops in `main.ts`;
  `destroy()` traverses the root disposing geometries, materials and canvas textures.

This is ambient visual polish + an ad surface, not a verified paid product. Visual
acceptance (how it reads against the SA sky) is a browser/QA check.
