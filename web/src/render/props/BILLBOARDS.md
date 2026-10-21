# Original unsold billboard art

`createParodyBillboards({world,low,isUnsold})` checks `flags.parodyBillboards`.
Use the same world adapter and mount/update/destroy lifecycle as street props.
It draws the six selected original artworks on nearby source catalogue candidates,
using stable `BILLBOARD_SURFACES` IDs. Candidates without loaded ground or clear
space outside roads/buildings are skipped; positions may move up to 18m along
their normal. These are authored game placements, not a survey of real signs.

Only eight/sixteen billboards are visible over 240m/400m. Changes are bounded to
1.5-second updates or 40m movement. The 1024x768 atlas is under 1MP and has no
bloom/emissive material. Paid inventory, impressions, rental prices and Checkout
are separate systems. Once `rentals` is on, supply canonical `isUnsold(id)`;
without it the renderer fails closed and displays no artworks. Unknown or paid
IDs must return false. It never replaces a paid creative or modifies ownership.

The six artworks were inspected in the packed atlas. The real-map smoke on
2026-10-03 at 07:01 UTC shows three clear Ferry-area candidates in both normal
and low detail. An unobstructed, ground-height approach to an actual placed
Fog Compute board was captured on desktop and touch phone with production bloom;
the headline remains readable without emissive washout. The shared smoke has
zero console, page or world errors; evidence and screenshots are in
`artifacts/street-props/preview/`. Main mounts, updates and disposes the module in
normal and cinematic play. This supports local enablement, not A10 surveyed
placement or rental/deployment acceptance.
