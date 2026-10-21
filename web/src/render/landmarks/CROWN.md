# Salesforce Outbid crown

`createOutbidCrown(landmarks)` attaches to the existing Salesforce Tower and checks
`flags.outbidCrown`. Forward canonical HTTP/WorldDO state through
`crown.setSnapshot(snapshot)` alongside the banner update. Call `crown.destroy()`
before disposing the landmarks. Invalid or stale snapshots have no effect; an
empty newer snapshot hides the display, including after a refund or moderation
removal. Approval and payment authority belong to the backend.

The curved band repeats the winning name and message on four sides. Test-mode
state is visibly labelled TEST. The renderer fetches no media, has no animation
or polling loop, and uploads its single 1024×512 sRGB texture only when displayed
content changes. It does not render uploaded logos. The base landmark builder
remains pure vertex-colour geometry without textures.

Enable only when the root forwards the canonical approved snapshot. Missing
payment or moderation services leave the UI unavailable and this crown empty;
there is no example paid bidder in the game. `tools/outbid-crown-smoke.mjs` uses
explicit isolated test data for its visual evidence, never a production route.
