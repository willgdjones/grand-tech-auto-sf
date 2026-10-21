# Full avatar appearance — gtasf-looks-avatar-render-jge1

Status: implementation under review. The existing `characterLooks` flag controls
`AvatarInstance.applyLook`; it remains off in the source configuration. This work
does not enable production or claim the complete appearance feature accepted.

## Renderer contract

```ts
const look = resolveLook(appearance, fundingRound);
const avatar = template.createInstance(outfitIndex, look);
avatar.applyLook(look); // also valid after the instance is already animated
```

`createInstance(outfitIndex)` and `setOutfit(index)` retain the existing four-palette
interface. `applyLook` supports all eight palette indices. It applies the body,
archetype prop, funding-tier garments, hairstyle, hair colour and accessory from
the shared `ResolvedLook`. Repeated identical looks do not rebuild geometry.

`avatarLookChoices` in `appearance.ts` supplies the wardrobe's installed
`outfit`, `hair`, `hairColor` and `accessory` catalogues, with indices 0–7. All are
cosmetic choices available at every stage; the garment's formality follows the
resolved funding tier. The shared contract owns unlocking and stage selection.

The shipped CC0 Quaternius model remains the animation source. The second body
mesh adjusts jaw, waist, shoulder and hip proportions in cloned geometry while using
the same skeleton and hand/foot anchors. Source geometry stays immutable.
Hairstyle is independent of body choice. Geometry, collars, seams, pockets,
lapels, eyewear and props are authored here, without new downloads. The original
connected leg mesh and sleeve geometry retain their animation weights; higher
tiers recolour the lower legs as fabric. Hats tuck the crown hair beneath their
rim while retaining long hair below it.

The twelve props are a laptop, lanyard/tote, hardware wallet, soldering tool roll,
sketchbook, earbuds, lab coat, folded bicycle, phone gimbal, company badge, varsity
trim and coffee. Bone sockets use the actual idle pose. Handheld and bulky props
hide in seats and all personal-ride poses so hands remain available for controls.
The complete appearance follows camera opacity and instance cleanup.

## Game integration

`gtasf-hrmk.1` wires saved cosmetics, the wardrobe, identity/profile changes and
full peer looks into `main.ts`. The local look applies before `syncAppearance`'s
network/round early return, including offline updates. Existing peers receive
APPEARANCE changes and late-created avatars use the cached value; leave/welcome
cleanup removes both. See [APPEARANCE-INTEGRATION.md](APPEARANCE-INTEGRATION.md)
for the full contract and the parent in-game/activation gates that remain open.

Stage cars use `vehicles/models/stageCar.ts` and their existing perk flow.
`founderStatus.ts` supplies the world layer for assistants, entourage and the
decorative jet, using the same flag and `ResolvedLook` fields. Install its wrapper
once before any avatar instances are created:

```ts
const avatarTemplate = withFounderStatus(avatarSource, {
  scene,
  heightAt: sampleAuthoredThenMapGround,
  collides: collidesWithLandmarksOrMap,
  isLoaded: hasAuthoredOrLoadedMapGround,
});
```

The callbacks include authored plazas and decks, plus the map surface selected
by reference height; `main.ts` supplies these adapters as documented in
[APPEARANCE-INTEGRATION.md](APPEARANCE-INTEGRATION.md).
The wrapper retains the template API and applies to local and remote instances.
Unicorn gets one animated assistant; Decacorn gets two and a swept-wing jet.
Followers use the underlying template, so they cannot recursively create status
effects. They sample loaded ground and collision along each step, hide in seats
and personal rides, and are removed on a down-round or owner disposal. They are
cosmetic, without player IDs, packets, payouts or collision bodies. The jet uses
three merged material meshes on a wall-time orbit. Its world placement and look
still need visual verification. Angel NPC `CelebAppearance` uses a different
contract and needs its own adapter.

## Verification and limits

The scoped source smoke loads the actual shipped GLB, applies both body variants
across all twelve archetypes and six tiers, animates/fades the rig, checks remote
independence and disposal, and exercises the disabled flag. Existing riding and
driving checks remain part of the same targeted run. The four targeted tests
passed on 2026-10-04 at 12:13 UTC, followed by the strict web TypeScript check,
through `tools/heavy.sh` with one Vitest worker. The first shared strict check
caught an overly narrow `Group` parameter; it was corrected to the actual
`Object3D` returned by SkeletonUtils before the final successful check.

The founder-status smoke passed on 2026-10-04 at 12:38 UTC, followed by the strict
web check. It loads the shipped GLB and checks slope contact, movement, opacity,
blocked/unloaded terrain, seated visibility, tier removal, wrapped creation and
disposal, and the disabled flag. This source check does not establish its world
integration or visual acceptance.

`tools/avatar-appearance-look.mjs` builds an isolated actual-renderer gallery for
pane 6 to review. Its explicit fixture enables character looks and ride poses
without changing source flags. Desktop views cover archetypes front/back, all
tiers, hair and accessories; selected phone views cover movement and rider
visibility. The report records input hashes, source drift and browser errors.
This component gallery cannot establish in-game multiplayer, phone performance,
real-device or production visual acceptance. Those gates remain open.
