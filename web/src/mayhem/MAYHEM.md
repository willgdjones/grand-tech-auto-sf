# Playful Mayhem

The existing `playfulMayhem` flag gates the controller, renderer, world command
and server relay. It remains off pending pane 6's next candidate check.

On foot, Q fires the selected toy and X cycles paintball, confetti and water.
Phones use the Mayhem buttons in Game options; tapping closes the menu before
the action runs. Driving and other open dialogs block firing. Colours follow
the current startup name. Uploaded logos remain unavailable pending moderation.

A successful local shot renders once and sends the existing `MAYHEM_FIRE`
packet. Nearby peers render the server broadcast; the sender is not echoed.
Received water within three metres slows the receiving player to 55% for
1.5 seconds, then expires. Paintball and confetti do not slow players.
The server applies its existing 350 ms cooldown and 250 m relay radius.
Round-close confetti uses the same relay; no per-frame network event is added.

Pane 6's candidate check should cover Q/X, the phone menu buttons, a nearby
peer seeing a shot, a distant peer not seeing it, and water slowdown/recovery.
