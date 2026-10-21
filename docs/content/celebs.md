# Hidden angel-investor NPCs — roster for founder approval

**Bead:** `gtasf-v2-angel-npcs-v4i6` · **Plan:** PLAN-v2 decision 4 (pane 6)
**Flag:** `celebNpcs` — **OFF in production until the founder signs off this file.**

> These are **parody** characters. Every NPC carries a visible "parody" tag, is
> modelled low-poly with **no real face**, and speaks **affectionate jokes only** —
> never a factual claim, a quote, an endorsement, or anything a real person is
> said to have actually done or believed. If anything here reads as a real
> statement rather than an obvious gag, cut or rewrite it before approval.

## How it plays
- Each NPC walks a short set route in a **hidden** SF spot (an alley, a rooftop
  stair, a quiet plaza corner). They are **not shown on the map or radar.**
- You hear about them only through **rumours** — a radio aside or an ambient
  chat line that hints at a neighbourhood, never an exact pin (see
  `shared/content/flavour.ts`, `NPC_RUMOURS`).
- Walk up and press **E** to pitch. You get a one-off cheque and a short reply.
- **Once per NPC per player, ever.** A second pitch to the same NPC just gets a
  polite brush-off, no money.
- The cheque is recorded as a funding source and shows on your **cap table**
  (click-a-player panel, `gtasf-2r5r`), labelled by the parody name + "(parody)".

## Cheque tiers
Harder-to-find NPCs pay more. Amounts are game dollars (stored as integer cents).
The economy-v3 base follows pane 4's October 4 calibration. The founder's
one-third-of-Seed ceiling is **$25,000**, against the **$75,000** Seed threshold;
even the rarest cameo cannot reach Seed from zero. Higher tiers pay more within
that ceiling. Both client pitch copy and Worker credits use the same shared
selection; the existing `economyV3` flag selects these amounts.

| Tier | Feel | V2 cheque (`economyV3` off) | V3 cheque (`economyV3` on) | Who |
|---|---|---|---|---|
| `angel` | tucked-away but on the main corridor | **$500K** | **$21,629** | most of the roster |
| `notable` | off the beaten path, a little climb | **$2M** | **$22,500** | harder spots |
| `legend` | hidden, rewards exploring | **$6M** | **$23,750** | the deepest few |
| `mega` | rare big-tech cameo | **$40M** | **$25,000** | the four icons |

The v3 tuning does not enable either feature. `economyV3` still needs its
coordinated migration and founder-reviewed rollout; `celebNpcs` still needs the
roster/dialogue approval below and native find → pitch → cap-table acceptance.

## Roster — SF angels (parody)
Spots are hidden but fitting; all sit within the reachable Ferry → North Beach →
Lombard → Hayes Valley → Mission corridor. Exact coordinates live in
`shared/content/celebs.ts`.

| # | Parody NPC | Hidden spot | Tier | Parody line (pitch reply) |
|---|---|---|---|---|
| 1 | Ron Conway | Jackson Square alley, FiDi | notable | "Everyone in this town has my number. You just got my voicemail — that's a yes." |
| 2 | Naval Ravikant | Rooftop bench above the Embarcadero | legend | "Seek wealth, not a follow-up meeting. But also, wire me the follow-up meeting." |
| 3 | Elad Gil | Side door of a FiDi tower | notable | "I've quietly backed everyone you've met today. Including that pigeon." |
| 4 | Lachy Groom | Pier bollard, north waterfront | angel | "Small round, big conviction, zero paperwork. Go." |
| 5 | Gokul Rajaram | Food truck line, SoMa edge | angel | "I call this the Gokul test: did the line move? No? Here's a cheque anyway." |
| 6 | Nat Friedman | Garage workbench, North Beach | notable | "Ship first, raise second. You did it backwards, which I respect." |
| 7 | Daniel Gross | Same garage, other stool | notable | "Nat already said yes, so now I have to. Classic us." |
| 8 | Garry Tan | Stoop near a co-working door | angel | "Batch is full. The sidewalk batch, however, is wide open. You're in." |
| 9 | Paul Graham | Park bench with a stack of paper | legend | "I wrote a 4,000-word essay about this exact conversation. Here's the TL;DR: cheque." |
| 10 | Jessica Livingston | Beside the same bench | notable | "He talks, I decide. Decided. Go build the thing." |
| 11 | Alexis Ohanian | Dog run near Washington Square | angel | "Front page of the internet, back alley of the funding. Take it." |
| 12 | Jason Calacanis | Café patio, loud corner | angel | "I'm ANGRY about how good this is. Angry-invest activated." |
| 13 | Scott Belsky | Design-studio doorway, SoMa | angel | "Messy middle, clean cheque. You're somewhere in the middle." |
| 14 | Balaji Srinivasan | Hilltop lookout, Telegraph Hill | legend | "Exit to the network state — but first, exit to this park bench and take the money." |
| 15 | Sriram Krishnan | Rooftop with a view of the bridge | notable | "Good tweet. Even better term sheet. Both from me." |
| 16 | Aaron Levie | Outside a SoMa office lobby | angel | "I made one joke and one bet. Both landed. This is the bet." |
| 17 | Guillermo Rauch | Deploy-sticker-covered scooter | angel | "Ship it. I already deployed the cheque to production." |
| 18 | Amjad Masad | Laptop on a Mission stoop | angel | "You vibe-coded a company? Fork accepted. Funded." |
| 19 | Immad Akhund | ATM nook, FiDi | angel | "Banking's boring, so I'll make this fast. Done." |
| 20 | Sahil Lavingia | Sidewalk easel, Hayes Valley | angel | "Minimalist round. One line, one cheque, no board seat." |
| 21 | Ryan Hoover | Product-launch booth, Mission | angel | "Product of the day: you. Upvoted with cash." |
| 22 | Lenny Rachitsky | Newsletter kiosk, Hayes Valley | angel | "This is a growth loop. The loop is: I give you money, you tell your friends." |
| 23 | Shaan Puri | Podcast mic on a bench | angel | "Great pod guest energy. That's worth a small, loud cheque." |
| 24 | Sahil Bloom | Morning-run path, waterfront | angel | "Five habits of funded founders. Habit one: take this." |
| 25 | Kevin Hartz | Ticket window, old theatre | notable | "I've seen this show before. It usually sells out. Here." |
| 26 | Chris Sacca | Lowercase bar stool, North Beach | legend | "I retired from this. Clearly I'm bad at retiring. Cheque." |
| 27 | Sarah Guo | Co-working phone booth, SoMa | notable | "New stack, new founder, same instinct: yes." |
| 28 | Tobi Lütke | Back of a corner shop | notable | "Commerce is everywhere, including this sidewalk. Checkout complete." |
| 29 | Dylan Field | Whiteboard in a garage window | notable | "Nice frame. I'll fund the component." |
| 30 | Patrick Collison | Quiet stair off an FiDi lane | legend | "Payments are a line of code. So is this. Sending." |

## Mega-cheque icons (parody, rare)
Four big-tech cameos remain as rare, deeply hidden "mega cheques". Same safeguards.

| Parody NPC | Hidden spot | Tier | Parody line |
|---|---|---|---|
| Elon | Rooftop near Market St, by an old bird logo | mega | "I renamed your startup to a single letter. You're welcome. Here's the money." |
| Zuck | Hydrofoiling past the Embarcadero sea wall | mega | "I will fund you in the metaverse and also, confusingly, in real dollars." |
| Jensen | SoMa loading dock, leather jacket | mega | "The more GPUs you ask for, the more I give. That's the whole pitch. Take it." |
| Altman | Mission Bay-ish side street | mega | "Compute credits? Sure. Actual money? Also sure. Scaling laws, baby." |

## Rumour hints (radio + ambient chat)
Short, location-flavoured teasers — a neighbourhood, never a pin. Examples
(final set in `shared/content/flavour.ts`, `NPC_RUMOURS`):
- "Word is a certain angel's been pacing the alleys off Jackson Square again."
- "Someone swears they saw a parody of a famous investor on a Telegraph Hill bench."
- "Rooftop regulars say the quiet money shows up above the Embarcadero around now."
- "A garage in North Beach apparently has two investors arguing over who said yes first."
- "If you hear a leather jacket near the SoMa docks, that's a mega cheque, not a motorcycle."

## Appearance — loose resemblance (bead `gtasf-angel-loose-resemblance-cc13`)
Each NPC now carries a bounded, enum-driven **loose-resemblance** descriptor in
`CELEB_APPEARANCE` (`shared/content/celebs.ts`) — build, hair (style + colour), facial
hair, glasses, a signature outfit and a single prop — sourced from
`docs/content/angel-appearances.md`. These are **descriptors only, never real faces**:
pane 6 maps them to low-poly avatar parts (e.g. Jensen → leather jacket + a GPU; Zuck →
grey tee + curly hair; Naval → beard + calm stance; PG → plain shirt + a stack of essays).
Keep it kind and readable from a distance; the "parody" tag and `celebNpcs` kill switch
still apply. The appearance never adds a real-person face texture.

## Founder approval checklist
- [ ] Names/likenesses OK to ship as **parody** (low-poly, no real face, "parody" tag).
- [ ] Every line is an **affectionate joke** — no factual claim, quote or endorsement.
- [ ] **Loose-resemblance appearances** (build/hair/glasses/outfit/prop) are fine as parody — no real faces.
- [ ] Spots and tiers are fine; cheque amounts are fine (pane 4 to tune).
- [ ] Any NPC to **drop** before launch? (strike the row)
- [ ] Approve flipping `celebNpcs` **on** for production.

Until every box is checked, `celebNpcs` stays **OFF** in
`tools/deploy/production/prepare.ts`'s allowlist and the feature is dev-only.
