/**
 * D1 persistence and deterministic grouping for F-key player feedback (PLAN-v2 §10).
 *
 * Themes are derived by keyword matching only. The feedback text is never executed,
 * evaluated as an instruction, or sent to an LLM here; `classifyTheme` is a pure
 * function so the same text always lands in the same group and can be unit-tested.
 * Nothing in here creates beads or sends messages — it only records and reads back.
 */

export interface FeedbackInput {
  /** Player-written message (already length-bounded by the route). Untrusted. */
  text: string;
  /** Optional screenshot as a bounded data URL, or null. Untrusted. */
  screenshot?: string | null;
  mode?: string | null;
  round?: string | null;
  startup?: string | null;
  nick?: string | null;
  worldX?: number | null;
  worldZ?: number | null;
  lat?: number | null;
  lon?: number | null;
  locationName?: string | null;
  path?: string | null;
  /** gtasf-367l: build / changelog version the report was filed on. `undefined` = don't store it (the
   *  route leaves it unset while flags.feedbackBuildTag is off, so the INSERT never names the build
   *  column before migration 0032 adds it). A string (or null) means store it. Untrusted. */
  build?: string | null;
}

export interface FeedbackRecord extends FeedbackInput {
  id: string;
  createdAt: string;
  theme: string;
}

export interface FeedbackDigestItem {
  id: string;
  createdAt: string;
  text: string;
  mode: string | null;
  round: string | null;
  startup: string | null;
  nick: string | null;
  locationName: string | null;
  lat: number | null;
  lon: number | null;
  /** A deep link that drops the founder onto the spot the feedback was filed from. */
  jump: string | null;
  hasScreenshot: boolean;
  /** gtasf-367l: the build / changelog version the report was filed on; null until the column exists
   *  and flags.feedbackBuildTag is on (then older rows are still null). */
  build: string | null;
}

export interface FeedbackDigest {
  total: number;
  since: string | null;
  themes: { theme: string; count: number; items: FeedbackDigestItem[] }[];
}

/**
 * Ordered theme definitions. Scoring counts distinct keyword hits per theme and
 * picks the highest; ties fall to the earlier entry here, so the order is the
 * documented tie-break. Feature themes sit before the generic "crash-or-bug" so
 * "the car controls are broken" groups under driving, while "it crashed" does not.
 */
const THEMES: { theme: string; keywords: RegExp }[] = [
  { theme: 'performance', keywords: /\b(lag|laggy|fps|framerate|frame rate|stutter|stuttering|choppy|slow|slowdown|freezing|hitch|hitches|loading|load time)\b/i },
  { theme: 'driving-and-controls', keywords: /\b(driv(e|ing)|car|vehicle|steer(ing)?|brak(e|ing)|drift|handling|control(s|ler)?|wasd|keyboard|gamepad|joystick|accelerat\w*|reverse|throttle)\b/i },
  { theme: 'camera', keywords: /\b(camera|fov|field of view|zoom|orbit|tilt|viewpoint|angle)\b/i },
  { theme: 'map-and-navigation', keywords: /\b(map|gps|route|waypoint|navigat\w*|direction|minimap|radar|get lost|got lost)\b/i },
  { theme: 'funding-and-events', keywords: /\b(funding|fund|money|cash|event|rounds?|stage|cheque|check|leaderboard|startup|pitch|vc|raise|raised|investor)\b/i },
  { theme: 'multiplayer-and-chat', keywords: /\b(chat|multiplayer|nameplate|bubble|other player|other people|another tab|second tab|friend)\b/i },
  { theme: 'audio', keywords: /\b(sound|audio|music|radio|volume|horn|noise)\b/i },
  { theme: 'mobile', keywords: /\b(phone|mobile|touch(screen)?|tablet|ios|iphone|ipad|android)\b/i },
  { theme: 'visuals-and-look', keywords: /\b(graphics|texture|visual|sky|fog|lighting|shadow|ugly|blurry|pixel\w*|building|trees?|colou?r|facade|render\w*)\b/i },
  { theme: 'crash-or-bug', keywords: /\b(crash\w*|bug|broken|error|glitch\w*|stuck|frozen|froze|clipping|fell through|does ?n'?t work|did ?n'?t work|not working|can'?t|cannot)\b/i },
];
const DEFAULT_THEME = 'general';

/** Pure: the same text always maps to the same theme. Never executes the text. */
export function classifyTheme(text: string): string {
  let best = DEFAULT_THEME;
  let bestScore = 0;
  for (const { theme, keywords } of THEMES) {
    const matches = text.match(new RegExp(keywords.source, 'gi'));
    const score = matches ? matches.length : 0;
    if (score > bestScore) { bestScore = score; best = theme; }
  }
  return best;
}

/** Number of submissions from one ip digest within the trailing window (rate limiting). */
/** gtasf-6z5zi: blank ip_hash on reports older than a day (it only serves the one-minute rate window). */
export async function scrubOldIpHashes(db: D1Database, now: number): Promise<void> {
  await db.prepare(`UPDATE feedback SET ip_hash='' WHERE ip_hash<>'' AND created_at < ?`).bind(new Date(now - 86_400_000).toISOString()).run();
}
export async function recentCountForIp(db: D1Database, ipHash: string, sinceIso: string): Promise<number> {
  const row = await db.prepare('SELECT COUNT(*) AS n FROM feedback WHERE ip_hash = ? AND created_at >= ?')
    .bind(ipHash, sinceIso).first<{ n: number }>();
  return row?.n ?? 0;
}

/** Insert one feedback row. Returns the stored record (without echoing the screenshot). */
export async function insertFeedback(
  db: D1Database,
  input: FeedbackInput,
  meta: { id: string; createdAt: string; ipHash: string; userAgent: string | null },
): Promise<FeedbackRecord> {
  const theme = classifyTheme(input.text);
  // Column names are fixed literals (no user input), so the INSERT is assembled dynamically only to
  // include the gtasf-367l `build` column when a build was supplied — i.e. when the route opted in via
  // flags.feedbackBuildTag. Omitting it keeps the SQL identical to before migration 0032. [gtasf-367l]
  const cols = ['id', 'created_at', 'text', 'theme', 'screenshot', 'mode', 'round', 'startup', 'nick',
    'world_x', 'world_z', 'lat', 'lon', 'location_name', 'path'];
  const values: (string | number | null)[] = [meta.id, meta.createdAt, input.text, theme, input.screenshot ?? null,
    input.mode ?? null, input.round ?? null, input.startup ?? null, input.nick ?? null,
    input.worldX ?? null, input.worldZ ?? null, input.lat ?? null, input.lon ?? null,
    input.locationName ?? null, input.path ?? null];
  if (input.build !== undefined) { cols.push('build'); values.push(input.build ?? null); }
  cols.push('ip_hash', 'user_agent'); values.push(meta.ipHash, meta.userAgent);
  await db.prepare(
    `INSERT INTO feedback (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(',')})`,
  ).bind(...values).run();
  return { ...input, id: meta.id, createdAt: meta.createdAt, theme };
}

interface DigestRow {
  id: string; created_at: string; text: string; theme: string;
  mode: string | null; round: string | null; startup: string | null; nick: string | null;
  lat: number | null; lon: number | null; location_name: string | null; screenshot: string | null;
  build?: string | null;
}

function jumpLink(row: DigestRow): string | null {
  if (typeof row.lat === 'number' && typeof row.lon === 'number' && Number.isFinite(row.lat) && Number.isFinite(row.lon)) {
    return `/?at=${row.lat.toFixed(6)},${row.lon.toFixed(6)}`;
  }
  return null;
}

/**
 * Build the admin digest: every theme with its submissions, newest first, grouped
 * and ordered by volume. Screenshots are summarised as a boolean so the digest
 * stays small; a separate endpoint serves a single screenshot on demand.
 */
export async function feedbackDigest(db: D1Database, limit = 500, includeBuild = false): Promise<FeedbackDigest> {
  const bounded = Math.max(1, Math.min(2000, Math.floor(limit)));
  // gtasf-367l: only name the `build` column when flags.feedbackBuildTag is on (passed by the route),
  // because migration 0032 adds it — selecting it before then would throw. Off = pre-367l SELECT.
  const { results } = await db.prepare(
    `SELECT id, created_at, text, theme, mode, round, startup, nick, lat, lon, location_name, screenshot${includeBuild ? ', build' : ''}
       FROM feedback ORDER BY created_at DESC LIMIT ?`,
  ).bind(bounded).all<DigestRow>();
  const rows = results ?? [];
  const groups = new Map<string, FeedbackDigestItem[]>();
  for (const row of rows) {
    const item: FeedbackDigestItem = {
      id: row.id, createdAt: row.created_at, text: row.text, mode: row.mode, round: row.round,
      startup: row.startup, nick: row.nick, locationName: row.location_name,
      lat: row.lat, lon: row.lon, jump: jumpLink(row), hasScreenshot: Boolean(row.screenshot),
      build: includeBuild ? (row.build ?? null) : null,
    };
    const list = groups.get(row.theme);
    if (list) list.push(item); else groups.set(row.theme, [item]);
  }
  const themes = [...groups.entries()]
    .map(([theme, items]) => ({ theme, count: items.length, items }))
    .sort((a, b) => b.count - a.count || a.theme.localeCompare(b.theme));
  return { total: rows.length, since: rows[rows.length - 1]?.created_at ?? null, themes };
}

/** Fetch a single submission's stored screenshot data URL (admin only). */
export async function feedbackScreenshot(db: D1Database, id: string): Promise<string | null> {
  const row = await db.prepare('SELECT screenshot FROM feedback WHERE id = ?').bind(id).first<{ screenshot: string | null }>();
  return row?.screenshot ?? null;
}
