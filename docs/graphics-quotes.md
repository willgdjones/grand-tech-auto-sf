# Graphics integration quotes (GTA-pivot lane A, Items 3 & 4)

Verified 2026-10-13. Traffic scenarios: **current ~10 sessions/day (~300/mo)** and **~1,000 sessions/day (~30k/mo)**.

## Item 3 — Meshy characters (crowd + SFPD officers + patrol car)
- **What:** generate ~16–20 rigged models (3 bake-off candidates + ~12 crowd looks + SFPD officers + 1 patrol car) via Meshy AI.
- **Unit price:** ~20–30 credits per textured Meshy-6 model (20 generate + 10 texture); auto-rig 0 credits in the web app (5 via API), animation 0 (3 via API). Pro plan $20/mo = 1,000 credits ⇒ ~$0.02/credit. Source: https://docs.meshy.ai/en/webapp/pricing
- **Monthly cost:** **traffic-independent** (one-time asset generation, not per-session — same at 10/day and 1,000/day). Total ~1,000–1,200 credits = **one month of Pro ($20)**, or **$0 marginal** if it fits the existing Meshy plan's monthly credits.

## Item 4 — Google Photorealistic 3D Tiles (realistic city geometry)
- **What:** stream Google's photorealistic 3D city tiles (prototype a: distance-only skyline; prototype b: full city with invisible collision).
- **Unit price:** billed per **root-tile request ≈ one player session** (a root request then streams up to 3h of renderer tiles, which are free and uncapped); ~**$6.00 per 1,000 sessions** after ~1,000 free/month. Source: https://developers.google.com/maps/documentation/tile/usage-and-billing (per-call rate: https://blog.afi.io/blog/what-is-the-google-photorealistic-3d-tiles-api.md)
- **Monthly cost @ ~10 sessions/day (~300/mo):** under the free tier ⇒ **$0/month**.
- **Monthly cost @ ~1,000 sessions/day (~30k/mo):** ~29k billable × $6/1k ⇒ **~$174/month** (less with volume discounts, which step down toward ~$2.40/1k at scale).
- **Non-cost caveats:** Enterprise SKU; mandatory Google attribution; no persistent tile caching (must stream live); external runtime/network dependency (streamed tiles don't count against the 87 MB bundle budget).
