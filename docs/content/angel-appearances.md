# Angel NPC loose-resemblance appearances (content reference)

**Bead:** `gtasf-angel-loose-resemblance-cc13` · **Founder requirement 2026-10-03.**
**Owner of the render + schema:** pane 6 (`web/src/avatar/*`, `shared/content/celebs.ts`).
This file is **content only** — raw material pane 6 maps to its low-poly model params.

> **Safeguards unchanged.** Low-poly, **no realistic faces**; these are affectionate
> **parody** silhouettes, not caricatures of anyone's features. Each row is a *loose*
> cue — build/silhouette, hair (colour/length), glasses, facial hair, a signature
> outfit and a prop — the founder's brief (e.g. "Jensen: black leather jacket; Zuck:
> grey tee + curly hair; Naval: beard + calm pose; PG: plain shirt + a stack of
> essays"). Keep it readable from a distance and kind. `celebNpcs` kill switch applies.

## Suggested schema (pane 6 decides)
`CelebNpc.outfit:number` today is just a palette index. Consider extending with a small,
enum-driven `appearance` so there are **no free-text faces**, only bounded low-poly parts:
```ts
interface CelebAppearance {
  build: 'slim' | 'average' | 'stocky' | 'tall';
  hair: 'none' | 'short' | 'buzz' | 'wavy' | 'curly' | 'long' | 'receding';
  hairColor: 'black' | 'brown' | 'blond' | 'grey' | 'red';
  facialHair: 'none' | 'stubble' | 'beard' | 'moustache';
  glasses: boolean;
  outfit: 'hoodie' | 'tee' | 'grey-tee' | 'button-down' | 'blazer' | 'leather-jacket'
        | 'western-shirt' | 'running-gear' | 'suit';
  prop: string;          // a single low-poly held/worn item, bounded set
  accentColor?: string;  // low-poly clothing tint
}
```
The `prop` and `outfit` carry most of the "loose resemblance"; faces stay generic.

## Batch 1 — the 30 SF angels (ids match `shared/content/celebs.ts`)
| id | build | hair | glasses | facial hair | outfit | prop |
|---|---|---|---|---|---|---|
| ron-conway | average | short grey | no | none | blazer | phone (always dialing) |
| naval-ravikant | slim | buzz/none | no | short beard | tee | small book, calm stance |
| elad-gil | tall | short brown | no | none | button-down | laptop |
| lachy-groom | slim | short brown | no | none | tee | oversized cheque |
| gokul-rajaram | average | short black | yes | none | button-down | coffee cup |
| nat-friedman | slim | short brown | no | none | hoodie | a wrench |
| daniel-gross | average | short brown | no | stubble | tee | laptop on a stool |
| garry-tan | average | short black | yes | none | hoodie (orange accent) | YC lanyard |
| paul-graham | average | receding grey | no | none | plain button-down | stack of essays |
| jessica-livingston | average | shoulder blond | no | none | smart-casual | clipboard |
| alexis-ohanian | tall | short brown | no | beard | tee | little alien mascot |
| jason-calacanis | stocky | short black | yes | none | blazer-over-tee | microphone |
| scott-belsky | average | short brown | yes | stubble | button-down | design notebook |
| balaji-srinivasan | slim | short black | no | none | tee | phone w/ network graph |
| sriram-krishnan | average | short black | yes | none | button-down | phone (a hot take) |
| aaron-levie | average | curly brown | no | none | blazer-over-tee | microphone |
| guillermo-rauch | slim | short black | no | short beard | sticker-covered tee | scooter w/ deploy stickers |
| amjad-masad | average | short black | no | beard | tee | laptop (a fork) |
| immad-akhund | average | short black | no | short beard | button-down | corporate card |
| sahil-lavingia | slim | short black | no | none | minimalist tee | a sketch easel |
| ryan-hoover | average | short brown | no | none | tee | product-launch badge |
| lenny-rachitsky | average | short brown | no | short beard | button-down | a newsletter |
| shaan-puri | average | buzz/none | no | beard | tee | podcast mic |
| sahil-bloom | slim/athletic | short brown | no | none | running-gear | running shoes |
| kevin-hartz | average | short brown | no | none | smart-casual | a ticket stub |
| chris-sacca | stocky | short brown | no | beard | western-shirt | cowboy hat (lowercase) |
| sarah-guo | average | long black | no | none | smart-casual | phone-booth/laptop |
| tobi-lutke | average | short red | yes | short red beard | hoodie | a shopping bag |
| dylan-field | average | wavy brown | no | none | tee | a whiteboard frame |
| patrick-collison | tall | short brown | no | none | button-down | a terminal/line of code |

## Batch 1 — the 4 mega cameos (iconic looks, founder-specified)
| id | build | hair | glasses | outfit | prop |
|---|---|---|---|---|---|
| elon | average | short dark | no | blazer-over-tee | a single letter "X" / tiny rocket |
| zuck | average | curly brown | no | **grey tee** | hydrofoil board |
| jensen | average | short grey | yes | **black leather jacket** | a GPU |
| altman | average | short brown | no | grey sweater/tee | a "compute credits" token |

## Batch 2 (~150) — archetype guidance
Don't fabricate specific faces for the long tail. Assign a **category archetype** and vary
`prop`/`accentColor` for recognisability, upgrading to a specific row only for the clearly
iconic (e.g. Marc Andreessen: bald, average build, blazer; Jack Dorsey: long hair + beard,
beanie, calm; Vinod Khosla: grey hair, glasses, button-down; Brian Armstrong: slim, short
blond, tee; Aileen Lee: long dark hair, smart-casual, a tiny unicorn prop):
- **Big-fund GPs** → blazer or button-down, prop = term sheet / memo.
- **Seed/solo capitalists** → hoodie or tee, prop = a small cheque / phone.
- **YC alumni-angels** → hoodie (orange accent), prop = office-hours timer.
- **Operator-angels** → their product as a prop (camera, chat bubble, grocery cart, etc.).
- **Crypto/fintech** → tee, prop = a hardware wallet / card.
- **Devtools/infra** → hoodie, prop = a laptop / container box.
- **AI founders** → tee, prop = a chalkboard / small robot sketch (no product logos).

Pane 6: fold the survivors of `docs/content/celebs-batch2.md` in, then assign appearances
from these archetypes; promote any you have a confident iconic look for to a specific row.
