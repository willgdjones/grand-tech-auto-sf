# Angel-investor NPCs — integration contract (gtasf-v2-angel-npcs-v4i6)

Hidden parody angel-investor NPCs (PLAN-v2 decision 4). Self-contained render module
modelled on `ferryPedestrians.ts`. **Pane 1 owns `main.ts`** — this is the wiring
contract; the module itself (`web/src/render/angelInvestors.ts`) is complete.

## Safeguards (do not weaken)
- **Flag `celebNpcs` is OFF in production** until the founder approves
  `docs/content/celebs.md`. Keep it out of the `prepare.ts` allowlist until then.
- NPCs use the generic hoodie rig (no real faces). Every NPC floats a
  `"<name> (parody)"` tag. Lines are affectionate jokes, not quotes/endorsements.
- NPCs are **never** added to the map or radar.

## Module API
```ts
import { createAngelInvestors } from './render/angelInvestors';
import { projectLocation } from './radar/projection';

const angels = createAngelInvestors({
  enabled: flags.celebNpcs,
  template: avatarTemplate,                 // same AvatarTemplate as pedestrians
  ground: surface,                          // MovementWorld
  isLoaded: (x, z) => world.heightAt(x, z) !== null,
  geoToWorld: (lat, lon) => projectLocation(lat, lon, world.manifest.frame),
  low: foundation.tier === 'low',
  pitched: fundingPitchedCelebIds,          // optional: seed from the player's funding profile
});
if (angels) scene.add(angels.root);
```
Returns `null` when the flag is off or there is no avatar template, so null-check with `?.`.

## Per-frame wiring (in `update(dt, now)`, next to the other city-life updates ~main.ts:594)
```ts
angels?.update(foot, dt);
const rumour = angels?.takeRumour(foot, now);   // throttled internally (≥60s apart)
if (rumour) notify(rumour, 6000);               // or route to the radio ticker
```

## Prompt footer (near main.ts:649, on-foot branch)
```ts
const angelPrompt = mode === 'on-foot' ? angels?.promptText(foot) ?? null : null;
setStatusText(prompt, angelPrompt
  ?? (mode === 'driver' ? 'WASD drive · Space handbrake · E exit'
    : nearbyVehicle ? 'E · Get in and drive' : 'WASD walk · Shift run · H hail a robotaxi'));
```
`promptText` returns `"E · Pitch Ron Conway (parody)"`, or `"… — already pitched"`, or null.

## E key (in `enterExit()`, before the parked-car check ~main.ts:291)
```ts
if (mode === 'on-foot' && angels) {
  const target = angels.nearest(foot);
  if (target) {
    if (target.alreadyPitched) { notify('You already pitched them. Try another neighbourhood.'); return; }
    const result = angels.pitch(foot);            // { npc, firstTime, chequeCents, line }
    if (result) { void awardAngelPitch(result, angels); return; }
  }
}
// …existing car logic…
```

`awardAngelPitch` records the cheque server-side (see below), then on success:
```ts
angels.markPitched(result.npc.id);
notify(`${celebLabel(result.npc)}: "${result.line}"  (+${formatFunding(result.chequeCents.toString())})`, 7000);
```
`result.chequeCents` is a `bigint` (integer cents), so stringify it for `formatFunding` and for the wire.

## Teardown
```ts
angels?.dispose();
```

## Server/award contract (pane 1 — funding core / `gtasf-v2-captable-model-55qd`)
The module does **not** touch the network; it only reports a validated, once-per-NPC intent.
Review **M3** is correct: the in-memory `pitched` set is **display-only** and must not be the
source of truth — a reload clears it and would re-pay. Gate the cheque on a server round-trip.

This folds directly into the v2 cap-table model rather than a bespoke route. Proposed:

- `recordFundingCredit({ deviceId, source: 'celebrity', sourceRef: celebId, amountCents, label })`
  where `amountCents = celebChequeCents(celebId)` (**bigint**, see `shared/content/celebs.ts`) and
  `label = celebLabel(npc)` (already the `"<name> (parody)"` string). Once-ever is the model's
  `UNIQUE(device, season, source, source_ref)` — a duplicate insert returns `firstTime: false`,
  no new money. `FundingSource` already includes `'celebrity'` (`shared/funding.ts`).
- Surface it as `WorldFunding.award(...)` or a small `POST /api/funding/pitch { celebId }` wrapper,
  gated by `flags.celebNpcs`; resolve `deviceId` via `fundingDevice(request, db)` (identity.ts);
  validate `celebById(celebId)`.
- The player's pitched celeb ids come from their credits where `source = 'celebrity'`, so the client
  seeds `pitched` via `angels.setPitched(ids)` on load, and the **cap table** (`gtasf-2r5r`) lists
  these rows under "Angel investors (parody)", labelled by the stored `label`.

Until that lands, the host may keep a **local once-ever record** (localStorage) and call
`markPitched`/`setPitched` — the module works either way, but that is dev-only and not authoritative.
