/**
 * SF district labels for the SA pause-menu map (PLAN-v2 decision 7) + a pure, canvas-free
 * de-overlap pass (gtasf-i801).
 *
 * Now that the map is citywide, the expanded map fits the whole city and every district label
 * projects on-screen at once; the downtown cluster (Financial District, Jackson Square, Chinatown,
 * Union Square, Nob Hill, Tenderloin, Civic Center, SoMa) collapses into unreadable overlapping text
 * at fit-zoom. SA's pause map keeps its labels clean, so we cull overlaps by priority: the most
 * iconic districts win, and a label is dropped when its projected centre falls within a min-gap of an
 * already-kept label. Zooming in spreads the projected centres apart, so culled labels reappear.
 */

export interface District {
  name: string;
  lat: number;
  lon: number;
  /** Collision priority: higher wins when two labels overlap. Iconic/large districts rank higher. */
  priority: number;
}

/**
 * SF neighbourhood centroids for the pause-map labels, across the whole city (the map now covers more
 * than the NE playable slice — deploy #5 coverage + the western districts). Priority orders the
 * de-overlap pass: iconic/large/tech-dense neighbourhoods win, so at fit-zoom you see the big names and
 * the finer ones appear as you zoom in. Districts beyond current road coverage are harmless — they
 * project off-screen and are culled until the map actually fits them.
 */
export const SF_DISTRICTS: readonly District[] = [
  // North-east core (the original playable slice).
  { name: 'Embarcadero', lat: 37.7955, lon: -122.3937, priority: 10 },
  { name: 'Financial District', lat: 37.7946, lon: -122.4006, priority: 9 },
  { name: 'SoMa', lat: 37.7785, lon: -122.3990, priority: 9 },
  { name: 'Union Square', lat: 37.7880, lon: -122.4074, priority: 8 },
  { name: 'Mission', lat: 37.7599, lon: -122.4148, priority: 8 },
  { name: "Fisherman's Wharf", lat: 37.8080, lon: -122.4177, priority: 8 },
  { name: 'North Beach', lat: 37.8003, lon: -122.4103, priority: 7 },
  { name: 'Chinatown', lat: 37.7941, lon: -122.4078, priority: 7 },
  { name: 'Marina', lat: 37.8037, lon: -122.4368, priority: 7 },
  { name: 'Mission Bay', lat: 37.7700, lon: -122.3920, priority: 7 },
  // Central + west + south, added as citywide coverage expands.
  { name: 'The Castro', lat: 37.7609, lon: -122.4350, priority: 7 },
  { name: 'Haight-Ashbury', lat: 37.7700, lon: -122.4466, priority: 7 },
  { name: 'The Richmond', lat: 37.7800, lon: -122.4700, priority: 7 },
  { name: 'The Sunset', lat: 37.7530, lon: -122.4940, priority: 7 },
  { name: 'Golden Gate Park', lat: 37.7694, lon: -122.4862, priority: 7 },
  { name: 'Presidio', lat: 37.7989, lon: -122.4662, priority: 7 },
  { name: 'Nob Hill', lat: 37.7930, lon: -122.4161, priority: 6 },
  { name: 'Russian Hill', lat: 37.8012, lon: -122.4187, priority: 6 },
  { name: 'Pacific Heights', lat: 37.7925, lon: -122.4382, priority: 6 },
  { name: 'Hayes Valley', lat: 37.7765, lon: -122.4245, priority: 6 },
  { name: 'Potrero Hill', lat: 37.7580, lon: -122.4000, priority: 6 },
  { name: 'Noe Valley', lat: 37.7500, lon: -122.4330, priority: 6 },
  { name: 'Twin Peaks', lat: 37.7544, lon: -122.4477, priority: 6 },
  { name: 'Ocean Beach', lat: 37.7590, lon: -122.5110, priority: 6 },
  { name: 'Telegraph Hill', lat: 37.8024, lon: -122.4058, priority: 5 },
  { name: 'Civic Center', lat: 37.7793, lon: -122.4177, priority: 5 },
  { name: 'Japantown', lat: 37.7852, lon: -122.4297, priority: 5 },
  { name: 'Western Addition', lat: 37.7805, lon: -122.4340, priority: 5 },
  { name: 'Dogpatch', lat: 37.7600, lon: -122.3880, priority: 5 },
  { name: 'Bernal Heights', lat: 37.7390, lon: -122.4160, priority: 5 },
  { name: 'Bayview', lat: 37.7290, lon: -122.3900, priority: 5 },
  { name: 'Tenderloin', lat: 37.7840, lon: -122.4130, priority: 4 },
  { name: 'Jackson Square', lat: 37.7974, lon: -122.4030, priority: 4 },
  { name: 'Glen Park', lat: 37.7340, lon: -122.4330, priority: 4 },
  { name: 'Excelsior', lat: 37.7240, lon: -122.4260, priority: 4 },
  { name: 'Rincon Hill', lat: 37.7869, lon: -122.3912, priority: 3 },
];

/**
 * A label candidate already projected to screen pixels, as a centred axis-aligned box. `halfW`/`halfH`
 * are half the label's rendered extents (centre text alignment), so wide names like "FINANCIAL
 * DISTRICT" are protected horizontally — a centre-distance test alone under-protects them.
 */
export interface LabelCandidate {
  x: number;
  y: number;
  halfW: number;
  halfH: number;
  priority: number;
}

/**
 * Greedy priority de-overlap. Candidates are assumed already projected and on-screen. Returns the
 * indices (into the input array, in input order) of the labels to draw: iterate from highest priority
 * down, keep a label when its box (grown by `padPx`) does not overlap any already-kept box. Pure and
 * deterministic — no canvas or live text metrics — so the draw loop and a unit test share it.
 */
/**
 * Index of the district whose centroid is nearest the given world point (x/z metres), or -1 for an
 * empty list. Used to mark the "you are here" district on the pause map. Pure; squared distance only.
 */
export function nearestDistrictIndex(districts: readonly { x: number; z: number }[], x: number, z: number): number {
  let best = -1, bestDist = Infinity;
  for (let i = 0; i < districts.length; i++) {
    const d = districts[i]!;
    const dd = (d.x - x) * (d.x - x) + (d.z - z) * (d.z - z);
    if (dd < bestDist) { bestDist = dd; best = i; }
  }
  return best;
}

export function cullOverlappingLabels(candidates: readonly LabelCandidate[], padPx = 0): number[] {
  const order = candidates.map((_, i) => i).sort((a, b) =>
    candidates[b]!.priority - candidates[a]!.priority || a - b);
  const kept: number[] = [];
  for (const i of order) {
    const c = candidates[i]!;
    let clash = false;
    for (const j of kept) {
      const k = candidates[j]!;
      if (Math.abs(k.x - c.x) < k.halfW + c.halfW + padPx && Math.abs(k.y - c.y) < k.halfH + c.halfH + padPx) {
        clash = true; break;
      }
    }
    if (clash) continue;
    kept.push(i);
  }
  return kept.sort((a, b) => a - b);
}
