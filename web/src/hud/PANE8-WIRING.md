# Pane 8 integration contracts (nameplates, feedback, What's new)

OrangeBeaver / pane 8. Three ready modules for pane 1 (TopazRaven) to wire into
`main.ts`. All behind flags, all committed. No module runs its own animation loop;
tick the ones that need it from the existing `update(dt, now)` near the `chat.update`
call, construct them in `boot()`, and `destroy()` them in the `pagehide` handler.

## 1. Overhead nameplates — `nameplates.ts` (flag `nameplates`, gtasf-5dlu)

`createNameplates({ onSelect?(peerId) })` → `{ update, setLeaders, destroy } | null`.

```ts
const nameplates = createNameplates({
  onSelect: id => {                                   // open that player's cap table (see §4)
    const nick = nameById.get(id);
    const leader = nick ? leaders.find(l => l.nickname === nick) : undefined;
    if (leader) capTable?.open({ deviceId: leader.deviceId, startup: leader.startupName, nick: leader.nickname });
  },
});
```

Per frame, right after `chat.update(...)`:
```ts
nameplates?.update(camera.camera, selfId, namedPeers, now);
```
- `namedPeers: Iterable<{ id, x, y, z, name? }>` in **metres**. Reuse the same
  `chatPositions` roster you build for chat, but add each peer's **nickname** as `name`.
- The plate shows "Startup · nick · stage · $raised"; startup/stage/raised come from the
  funding leaderboard joined by nickname. Feed it whenever the leaderboard refreshes:
  ```ts
  funding?.onLeaderboard(list => nameplates?.setLeaders(list)); // list: FundingLeader[]
  ```
- A peer with no known name is skipped; without a leaderboard match it shows just the nick.
- Plates hide when behind camera / offscreen / >80 m, avoid the cached HUD rects, cap at 24
  nearest, and sit just above the head (chat bubbles float higher at 2.2 m).

**Required main.ts change — the one real dependency:** build an `id → nickname` map.
`PLAYER_JOIN { id, name, pose }` is already emitted + decoded but currently ignored in
`main.ts message()`. Handle it (and drop on `PLAYER_LEAVE`) to keep the map, then attach
`name` to each entry of the roster you pass to `nameplates.update`. The peer wire `name`
equals the funding nickname (server forces it), so it joins directly to `setLeaders`.
Teardown: `nameplates?.destroy()`.

## 2. F-key feedback — `feedback.ts` (flag `feedback`, gtasf-10kp)

`createFeedback(options)` → `{ open, close, destroy } | null`. Self-registers the `feedback`
action (I added `feedback` to `ActionValues`, `KeyF:'feedback'` to `DESKTOP_ACTIONS`, and
removed `KeyF→horn` from `input.ts` KEYS; horn stays on gamepad button 4). No per-frame tick.

```ts
const feedback = createFeedback({
  actions,                                        // your Input().actions bus
  onModalChange: open => setModalControls(open),
  capture: () => { foundation.render(camera.camera); return canvas.toDataURL('image/jpeg', 0.85); },
  state: () => {
    const g = unprojectLocation(foot.x, foot.z, world.manifest.frame); // exported by feedback.ts
    return { mode, round: funding?.profile?.round?.label ?? null,
             startup: funding?.profile?.startupName ?? null, nick: funding?.profile?.nickname ?? null,
             worldX: foot.x, worldZ: foot.z, lat: g.lat, lon: g.lon,
             locationName: world.locationNameAt(foot.x, foot.z, 80, foot.y) ?? null };
  },
});
```
- `capture` MUST render then read the canvas synchronously (preserveDrawingBuffer is off).
- Without `capture`/`state` it degrades to text-only; wire both — screenshot + location are the point.
- Posts to `/api/feedback` itself (downscales the shot to ≤960 px). Teardown: `feedback?.destroy()`.
- Worker side: `worker/src/feedback/routes.ts → handleFeedbackRequest` is committed; add it to the
  `index.ts` fetch chain (see note in that file / commit gtasf-10kp). Admin digest at
  `/api/feedback/admin/digest` (needs ADMIN_TOKEN). Migration `0019_feedback.sql`.

## 4. Cap table — `capTable.ts` (flag `capTable`, gtasf-2r5r)

`createCapTable({ onModalChange })` → `{ open, close, destroy } | null`. No per-frame tick.

```ts
const capTable = createCapTable({ onModalChange: open => setModalControls(open) });
```
- `capTable.open()` (no arg) shows the local player's own cap table.
- `capTable.open({ deviceId, startup, nick })` shows another player's — wire it from the
  nameplate `onSelect` above (resolve peerId → nickname → leaderboard `deviceId`). `leaders` is the
  latest `FundingLeader[]` from `funding.onLeaderboard`; `nameById` is the PLAYER_JOIN map.
- A "My cap table" entry in Game options or the funding board can call `capTable.open()` so the
  feature is reachable even before nameplate clicks are wired.
- It fetches `/api/funding/captable[?device=]` itself and renders groups (events / VC drops /
  celebrity angels / warm intros) with subtotals, plus stage + total. Teardown: `capTable?.destroy()`.

## 3. What's new panel — `whatsNew.ts` (flag `changelog`, gtasf-q1no)

`createWhatsNew({ onModalChange })` → `{ showOnce, open, close, destroy } | null`.

```ts
const whatsNew = createWhatsNew({ onModalChange: open => setModalControls(open) });
// after the world/HUD is up and the loading card is gone:
whatsNew?.showOnce();   // shows once per deploy, localStorage-keyed by changelog version
```
Teardown: `whatsNew?.destroy()`. Optional reopen from Game options: `whatsNew?.open()`.

---
Contact approval to DM pane 1 was still pending when this landed; this doc is the handoff.
Ping OrangeBeaver on the bead threads (gtasf-5dlu / -10kp / -q1no) with anything unclear.
