/**
 * Allowed hidden spots a "Become an angel" sponsor can pick (docs/engineering/become-an-angel.md §9).
 *
 * World metres on the SF_FRAME convention (+x east, +y up, **-z north**), the same hidden-but-fitting
 * corridor and feel as the parody roster in shared/content/celebs.ts. A sponsor can only place an
 * angel at one of these — never on the Ferry clock face or mid-road. A spot taken by a live sponsored
 * angel is removed from the picker (see openSponsoredAngelSpots).
 *
 * Coordinates are **PROVISIONAL**, scattered around the reachable Ferry → FiDi → North Beach →
 * Telegraph Hill → Embarcadero → SoMa → Mission → Hayes Valley → Marina corridor. Pane 6 re-pins each
 * to a snapped, walkable point from the map manifest using the celebs.ts coordinate conventions; this
 * module's shape and helpers are independent of the exact numbers, so a re-pin is a values-only edit.
 */
export interface SponsoredAngelSpot {
  readonly id: string;
  readonly label: string;
  /** Provisional world-metre position; pane 6 re-pins to snapped ground. */
  readonly x: number;
  readonly z: number;
  /** Facing, radians (0 = +x/east). */
  readonly yaw: number;
}

export const SPONSORED_ANGEL_SPOTS: readonly SponsoredAngelSpot[] = Object.freeze([
  { id: 'fidi-jackson-alley', label: 'Jackson Square alley, FiDi', x: 1040, z: -1180, yaw: 0 },
  { id: 'fidi-tower-sidedoor', label: 'Side door of a FiDi tower', x: 820, z: -980, yaw: 1.6 },
  { id: 'fidi-quiet-stair', label: 'Quiet stair off an FiDi lane', x: 920, z: -1080, yaw: -1.6 },
  { id: 'fidi-atm-nook', label: 'ATM nook, FiDi', x: 760, z: -1140, yaw: 3.1 },
  { id: 'embarcadero-rooftop-bench', label: 'Rooftop bench above the Embarcadero', x: 1180, z: -1120, yaw: 2.3 },
  { id: 'embarcadero-seawall', label: 'Embarcadero sea-wall corner', x: 1260, z: -1040, yaw: 1.5 },
  { id: 'embarcadero-pier-bollard', label: 'Pier bollard, north waterfront', x: 1220, z: -1360, yaw: -0.8 },
  { id: 'northbeach-garage', label: 'Garage workbench, North Beach', x: 600, z: -1620, yaw: 0.4 },
  { id: 'northbeach-cafe-patio', label: 'Café patio, North Beach', x: 540, z: -1500, yaw: -2.2 },
  { id: 'northbeach-wineshop', label: 'Wine-shop doorway, North Beach', x: 500, z: -1680, yaw: 1.2 },
  { id: 'telhill-lookout', label: 'Hilltop lookout, Telegraph Hill', x: 760, z: -1760, yaw: -1.9 },
  { id: 'telhill-stair', label: 'Hidden stair, Telegraph Hill', x: 700, z: -1700, yaw: 0.7 },
  { id: 'washington-sq-dogrun', label: 'Dog run near Washington Square', x: 560, z: -1580, yaw: 2.9 },
  { id: 'soma-loading-dock', label: 'SoMa loading dock', x: 300, z: -760, yaw: 1.0 },
  { id: 'soma-office-lobby', label: 'Outside a SoMa office lobby', x: 220, z: -640, yaw: -1.2 },
  { id: 'soma-phonebooth', label: 'Co-working phone booth, SoMa', x: 180, z: -820, yaw: 2.0 },
  { id: 'soma-server-closet', label: 'Server-closet door, SoMa', x: 360, z: -700, yaw: -0.5 },
  { id: 'mission-stoop', label: 'Laptop on a Mission stoop', x: -120, z: -300, yaw: 0.2 },
  { id: 'mission-mural-alley', label: 'Mural alley, Mission', x: -220, z: -420, yaw: 1.7 },
  { id: 'mission-community-garden', label: 'Community garden corner, Mission', x: -80, z: -200, yaw: -2.0 },
  { id: 'hayes-easel', label: 'Sidewalk easel, Hayes Valley', x: -420, z: -720, yaw: 0.9 },
  { id: 'hayes-boutique', label: 'Boutique window, Hayes Valley', x: -360, z: -640, yaw: -1.4 },
  { id: 'hayes-kiosk', label: 'Newsletter kiosk, Hayes Valley', x: -480, z: -800, yaw: 2.5 },
  { id: 'marina-waterfront-path', label: 'Morning-run path, Marina waterfront', x: -200, z: -1900, yaw: 1.1 },
]);

const BY_ID = new Map(SPONSORED_ANGEL_SPOTS.map(spot => [spot.id, spot] as const));

/** The spot with this id, or undefined. */
export function sponsoredAngelSpot(id: string): SponsoredAngelSpot | undefined {
  return BY_ID.get(id);
}

/** Whether `id` is a real allow-list spot (regardless of whether it is currently taken). */
export function isSponsoredAngelSpot(id: string): boolean {
  return BY_ID.has(id);
}

/** Spots a new sponsor may pick: the allow-list minus any already taken by a live angel. */
export function openSponsoredAngelSpots(taken: Iterable<string> = []): SponsoredAngelSpot[] {
  const used = taken instanceof Set ? taken : new Set(taken);
  return SPONSORED_ANGEL_SPOTS.filter(spot => !used.has(spot.id));
}
