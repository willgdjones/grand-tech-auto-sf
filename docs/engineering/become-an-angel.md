# "Become an angel" — paid player-sponsored angel NPCs

**Bead:** `gtasf-become-an-angel-7ggb` · **Founder directive:** 2026-10-03.
**Flag:** `becomeAnAngel` (new). On in dev so it's reachable + testable with Stripe TEST
keys; **OFF in production** until the founder approves one real low-value purchase (`gtasf-e5m`).
**Owner of this design:** CalmForge (pane 10). **Build owners:** see §8.

A new **ad product** alongside billboards and the VC-fund-drop sponsor slot. Anyone
can pay ~**$100** to appear in the world as their own angel NPC — a self-sponsored,
opt-in likeness, so there are **no third-party likeness concerns** (unlike the
parody celebrity roster). They choose a **name**, a short **line**, an optional
**avatar colour**, and a **spot** from an allow-list of hidden spots. Jev moderates
the name and line. They appear as **"Angel (player-sponsored)"**. Players who find
and pitch them get a one-off cheque; the sponsor sees **how many founders pitched
them**.

This reuses three existing systems rather than inventing new ones:
- **pane 6** angel-NPC spawn / E-to-pitch / rumour hints (`gtasf-v2-angel-npcs-v4i6`,
  `shared/content/celebs.ts`, the world NPC module),
- **pane 7** sponsor-slot + ledger plumbing and **Stripe manual-capture Checkout**
  (`worker/src/ledger/{checkout,LedgerDO}.ts`, `gtasf-ury`),
- **pane 4/8** cap-table payout (`shared/captable.ts`, source `celebrity`).

## 1. Player flow
1. A "**Become an angel**" entry in the HUD (near billboards/sponsor-slot buy) →
   opens a form: display name, one-line pitch reply, avatar colour (optional),
   spot picker (from the allow-list below).
2. **Jev moderation** of name + line (see §4). Fail → inline reason, no charge.
3. **Checkout** (~$100) via the existing ledger Stripe Checkout (§5). Charges are
   **manual-capture**: authorise now, capture when the angel is live and clean.
4. On capture, the angel is **published** to the world NPC set as
   `sponsored: true`, `label: "Angel (player-sponsored)"`, at the chosen spot.
5. **Players pitch** it like any angel (walk up, press **E**) → one-off cheque,
   recorded on their cap table (source `celebrity`, §6). Once per NPC per player.
6. The **sponsor** sees a live **pitch count** ("214 founders have pitched you")
   in their account panel (§7). No founder PII — just the count and totals.

## 2. Flag & config
- `shared/flags.ts`: add `becomeAnAngel: false`. Checked at (a) the HUD entry
  point, (b) the submit route, (c) the world spawn merge. Off ⇒ none of it renders
  or routes.
- Independent of `celebNpcs` (the parody roster). A sponsored angel can ship even
  if the parody roster stays off, and vice-versa.
- `SPONSORED_ANGEL_PRICE_USD_CENTS = 10000n` (bigint). Price in **USD** — the Stripe account
  defaults to GBP, so checkout sets `currency: 'usd'` explicitly.

## 3. Data model (D1, new migration)
`sponsored_angels` (one row per purchased angel):

| column | type | note |
|---|---|---|
| `id` | text PK | ulid |
| `sponsor_device_id` | text | who bought it (for the dashboard + removal) |
| `display_name` | text | Jev-approved |
| `line` | text | Jev-approved, ≤140 chars |
| `avatar_color` | text null | validated hex, optional |
| `spot_id` | text | FK into the spot allow-list (§9) |
| `tier` | text | fixed `angel` ($500K) for v1 — sponsored angels don't buy a bigger cheque |
| `status` | text | `pending` → `live` → `removed` |
| `checkout_id` | text | ledger reference |
| `pitch_count` | integer | denormalised, incremented on each unique pitch |
| `created_at`,`published_at`,`removed_at` | int (ms) | |

Pitches reuse the existing per-player once-ever ledger used by the parody roster
(the angel's `id` is the NPC key). `pitch_count` is incremented in the same
transaction so the sponsor dashboard is authoritative, not client-reported.

## 4. Moderation (Jev = TypeSafe)
Jev is **TypeSafe** (`@typesafe-ai/sdk`), not Anthropic/OpenRouter — the
`gtasf-openrouter-migration-wxbt` migration only replaces the former *Anthropic* image
prescreen, so name/line moderation reuses the events-Jev pattern
(`worker/src/events/jev.ts`). Built: `worker/src/sponsoredAngels/moderation.ts`
(`createSponsorReviewer(apiKey, fetcher)` → `SponsorReviewer`), an injectable reviewer that
the submit route takes as an option (tested with a fake reviewer, as `submit.test.ts` does).
- Reject: a real, specific third-party person or company name (the sponsor uses their **own**
  self-chosen name/brand only, always shown with the visible "player-sponsored" tag + a
  report/removal path), slurs, harassment, hate, sexual content, threats, spam, ads for
  external goods/services, scams, or politics presented as fact.
- Allow: a self-name/made-up brand + an affectionate/benign one-liner.
- **Fails closed** and is **gated on `TYPESAFE_API_KEY`**; with no key the reviewer is never
  constructed and the submit route stays disabled (flag effectively off), never an open door.

## 5. Checkout & ledger (pane 7)
Reuse `worker/src/ledger/checkout.ts` + `LedgerDO`:
- New line-item kind `sponsored-angel`, amount `SPONSORED_ANGEL_PRICE_USD_CENTS`, `currency: 'usd'`
  (explicit — the account default is GBP).
- **Manual capture**: authorise at purchase, **capture on publish** once Jev +
  (optional) admin pass. Auto-void the authorisation if not published in N hours.
- Refund path on admin removal for cause (coordinate exact policy with pane 7, same
  as the VC-fund-drop sponsor slot).
- **Key selection (founder, 2026-10-03):** Stripe keys are now configured. Prefer the **TEST**
  keys (`STRIPE_TEST_SECRET_KEY` / `STRIPE_TEST_PUBLISHABLE_KEY` in `worker/.dev.vars`) whenever
  `ENVIRONMENT != production`, so local dev + the founder-path smoke test the full checkout with card
  `4242 4242 4242 4242`. Production uses the **live** key (`STRIPE_SECRET_KEY`; publishable
  `STRIPE_PUBLISHABLE_KEY` is a non-secret prod/web var) but keeps `becomeAnAngel` (and every other
  checkout flag) **OFF** until the founder approves one real low-value purchase end-to-end, then
  refunds it. **Never run a test charge against the live key.**
- Webhook signing secret (`STRIPE_WEBHOOK_SECRET`) is registered + stored by **pane 5**; never print it.

## 6. Payout & cap table (pane 4/8)
- A pitch cheque is a normal funding credit with `source: 'celebrity'` (the angel
  category), entry label = the sponsor's display name + " (player-sponsored)".
- No new cap-table source type needed; `shared/captable.ts` already groups
  `celebrity`. (If the founder later wants sponsored angels on their own line, add
  a `'sponsored-angel'` source there — flagged as a follow-up, not v1.)

## 7. Sponsor dashboard
- Minimal panel keyed by `sponsor_device_id`: angel status, spot, **pitch count**,
  total game-dollars dispensed, and a "remove my angel" button.
- Count comes from `pitch_count` (authoritative). No founder identities exposed.

## 8. Build slices & owners
| Slice | Owner | Gated by |
|---|---|---|
| Design/contract (this doc), flag, spot allow-list, data model + migration | CalmForge (pane 10) | — |
| World spawn merge of `sponsored_angels` into the NPC set (`sponsored:true` label) | **pane 6** (owns NPC module) | flag |
| Jev moderation over OpenRouter for name/line | pane 10 + **chat/events Jev owner** | OpenRouter key |
| Checkout line-item + manual capture + refund/void | **pane 7** (ledger) | Stripe keys (`gtasf-e5m`) |
| HUD "Become an angel" form + spot picker + sponsor dashboard | pane 10 (new `web/src/hud/*`) | flag |
| Pitch cheque → cap table (`celebrity` source, label) | reuse pane 4/8 payout API | flag |

Nothing here touches another pane's file without its sign-off; the cross-pane
pieces are **contracts** for those panes to implement. Pane 10 builds the flag, the
spot allow-list, the data model/migration, the HUD form, and the Jev call.

## 9. Spot allow-list
A fixed set of **hidden-but-fitting** spots (same corridor and "hidden" feel as the
parody roster), so sponsors can't place an angel on the Ferry clock face or mid-road.
Each spot is a snapped, walkable point with a short label; reuse the parody roster's
coordinate conventions in `shared/content/celebs.ts`. Spots already taken by a live
sponsored angel are removed from the picker. Target ~24 spots across FiDi, North
Beach, Telegraph Hill, Embarcadero, SoMa, Mission, Hayes Valley, Marina.

## 10. Safety
- **Opt-in self-sponsorship only** — no third-party likenesses, so no parody-label
  burden, but the "player-sponsored" tag is always visible so players know it isn't
  an official endorsement.
- Jev + admin removal list + per-sponsor rate limits. Removal voids/refunds per §5.
- All amounts integer USD cents / bigint. Live charges stay off in production behind the
  `becomeAnAngel` flag until the founder approves one real low-value purchase; local/smoke testing
  uses the Stripe TEST keys and card `4242 4242 4242 4242` only. No agent runs a live test charge,
  opens Stripe accounts, or moves real money under this design.
