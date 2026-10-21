# Combat enable — prepare.ts reviewed-set diff (DRAFT, not applied)

> **✅ Pre-enable gates PASS (2026-10-14, `docs/perf/combat-enable-gates.md`):** gate 3 (18+/decline), gate 2
> (HUD overlap) and gate 1 (phone-Low firefight perf) all pass. The firefight perf was recovered by five lane-B
> fixes (bead `gtasf-u9id`): raycast-cache + tracer-pool + the `[hidden]`/backdrop-blur leak fix + a steady-aim
> cast-result cache → **20.8 → 40.4 fps mean, p95 103 → 34.1 ms** (gate ≥30 / ≤50), 4 SFPD on screen, no errors.
> So the firefight-heavy flags (`serverHits`, `openPvp`, `wanted`) are now perf-clear too — no split needed on
> perf grounds. (`policeAir`/`trafficDrivers` still held on lane-A art, below.) The whole reviewed block can
> ship on the founder's OK.

The combat/police lane is review-passed (serverHits/openPvp/wanted/carjacking/storeRobberies all server-ok; fixes
1–5 in 66929c24) and verified (deterministic `combatScenario.test.ts` + the two-client browser capture). This is the
exact change to ship it: add these flags to the `reviewed` Set in `tools/deploy/production/prepare.ts`, **in the order
below** (dependency order). Nothing else changes — `prepare.ts` builds `worker/.wrangler/production/flags.ts` from the
`reviewed` set, so a flag ships iff it's listed here AND true in `shared/flags.ts` source (the guard at line ~663).

All of these are already `true` in `shared/flags.ts` (combat flags flip to dev-on at enable; `combatVfx`/`sfpdLook`
already dev-on), so the guard passes. `economyV3` is already in `productionOverrides` (prod-on), so the −2% death
cost works — no change needed there.

## The diff — insert into the `reviewed` Set (dependency order)

```diff
   'wetRoads',
+  // --- GTA-V pivot combat & police (lane B), review-passed 2026-10-14; enable together, in this order ---
+  'combat',          // master gate: 18+ age gate, health/armour HUD, WASTED/BUSTED death→respawn→valuation cost
+  'gore',            // blood subsystem; still behind the 18+ gate AND the per-player gore toggle (default on past 18+)
+  'weapons',         // fists/bat/pistol/SMG/rifle, weapon wheel, aim + fire (client); needs combat
+  'serverHits',      // server-authoritative FIRE/HIT: WorldCombat damage/death, R2 line-of-sight, 3s spawn protection; needs combat+weapons
+  'openPvp',         // players can damage each other; death = standard −2% wasted only, no bounty; needs serverHits
+  'wanted',          // wanted 1–5 + SFPD pursuit/roadblocks/escape+cooldown + wanted HUD + siren; needs combat
+  'gunShop',         // "Lead Capital" buy-weapon, valuation-priced + stage-scaled, + free world pickups; needs combat+weapons
+  'carjacking',      // pull-out cosmetic + car-theft wanted on a moving-traffic takeover; needs combat+wanted+rideAnyVehicle
+  'storeRobberies',  // MONEY: hold-up stores → daily-capped valuation payout + 2-star wanted; needs combat+storeRobberies+wanted
+  'ragdollAudio',    // ragdoll-lite + gunshot/siren + ped flee/cower (polish); needs combat
+  'combatVfx',       // lane A: muzzle flash/tracer/impact/blood on deps.fire.onShot; dev-on; needs combat
+  'sfpdLook',        // lane A: SFPD b&w livery + patrol officer on the subaru pursuit cars; dev-on; needs combat+wanted
   // warmGroundGrade (teleoperator look #2) is NOT here: ...
```

## Deliberately NOT in this diff (held on lane-A art)
- `policeAir` — helicopter (wanted 4) + SWAT van (wanted 5) ride car-GLB stand-ins (supercar/bus) until lane A ships
  real `police-heli`/`swat-van` models. Wanted 1–3 (cars + roadblocks) ships now via `wanted`; flip `policeAir` later.
- `trafficDrivers` — seated NPC drivers are INVISIBLE in-game (the Meshy traffic GLB is one opaque mesh with baked-on
  windows → driver occluded). Waits on lane A's translucent car-glass (Teleoperator cars pass), then flips on.

## Notes for the enable
- **18+ / gore gating survives**: `combat` + `gore` in the reviewed set only make the subsystems *available*; a player
  still must pass the 18+ click-through to see combat at all, and the gore toggle (default on past 18+) controls blood.
  Declining 18+ hides combat entirely and leaves the rest of the game fully playable (gate 3 evidence).
- **Pre-enable gates** (this change-set): full-stack phone perf with combat active (gate 1), combat HUD/controls look
  phone+desktop with no HUD overlap (gate 2), 18+ + gore + decline-playable shots (gate 3) — see their reports/shots in
  `docs/perf/` and `docs/sf-data/combat/`.
- Ship the whole block in one deploy (they're interdependent); the full vitest suite + the combat tests gate the deploy.
