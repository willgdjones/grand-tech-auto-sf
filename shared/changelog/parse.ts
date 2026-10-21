/**
 * Parses CHANGELOG.md (the single source of truth at the repo root) into structured
 * entries. Shared by the in-game "What's new" panel, the /changelog page and tests so
 * there is exactly one parser.
 *
 * The file follows the repo's Keep a Changelog convention:
 *
 *   # Changelog
 *   (intro + ## Conventions, both ignored)
 *   ## [Unreleased]                       <- collects entries between deploys
 *   ### Added / ### Changed / ### Fixed   <- optional grouping, flattened here
 *   - New: drive through an event to get funded. [gtasf-xxxx]
 *   ## [2026-10-04] — Playtest build      <- a milestone deploy, newest first
 *
 * The bracket token is the entry's version; an ISO date there (or the first em-dash
 * field after it) becomes `date`. The remaining em-dash fields form the title. Bullets
 * are "- "/"* " lines with indented continuations; a trailing `[gtasf-...]` bead tag
 * is stripped from the player-facing text. `## Conventions` is ignored by name.
 */
export interface ChangelogEntry {
  /** The bracket token, e.g. "2026-10-04", "v2.0" or "Unreleased". */
  version: string;
  /** ISO YYYY-MM-DD when the entry carries a valid date, else null. Never fabricated. */
  date: string | null;
  /** Human title after the version, or '' when the heading carried only a version. */
  title: string;
  /** Player-facing bullet text with any trailing bead tag stripped, in authored order. */
  bullets: string[];
  /** True once the entry represents a shipped deploy (dated, or not "[Unreleased]"). */
  released: boolean;
}

const HEADING = /^##\s+(.*\S)\s*$/;
const SUBHEADING = /^###\s+/;
const BULLET = /^\s*[-*]\s+(.*\S)\s*$/;
const BEAD_TAG = /(?:\s*\[gtasf-[a-z0-9.-]+\])+\s*$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const BRACKET = /^\[([^\]]*)\]\s*(?:[—–-]\s*(.*))?$/;

function isIsoDate(value: string): boolean {
  return ISO_DATE.test(value) && !Number.isNaN(Date.parse(value));
}

function parseHeading(text: string): Omit<ChangelogEntry, 'bullets'> | null {
  if (/^conventions$/i.test(text.trim())) return null; // Documentation section, not an entry.
  const bracket = BRACKET.exec(text.trim());
  const version = (bracket ? bracket[1]! : text.trim()).trim();
  if (!version) return null;
  const released = version.toLowerCase() !== 'unreleased';
  let date: string | null = isIsoDate(version) ? version : null;
  const titleFields: string[] = [];
  // Split on em-, en- OR whitespace-flanked ASCII hyphen, matching BRACKET's leading separator set
  // (an ISO date's own hyphens have no surrounding spaces, so `2026-10-02` is never split). [L13]
  for (const field of (bracket?.[2] ?? '').split(/\s+[—–-]\s+/).map(part => part.trim()).filter(Boolean)) {
    if (date === null && isIsoDate(field)) date = field;
    else titleFields.push(field);
  }
  return { version, date, title: titleFields.join(' — '), released };
}

/** Pure: same input always yields the same entries, newest first as authored. */
export function parseChangelog(markdown: string): ChangelogEntry[] {
  const entries: ChangelogEntry[] = [];
  let current: ChangelogEntry | undefined;
  let pendingBullet: string | undefined;
  function finishBullet() {
    if (current && pendingBullet !== undefined) current.bullets.push(pendingBullet.replace(BEAD_TAG, '').trim());
    pendingBullet = undefined;
  }
  for (const line of markdown.split(/\r?\n/)) {
    const heading = HEADING.exec(line);
    if (heading) {
      finishBullet();
      const parsed = parseHeading(heading[1]!);
      current = parsed ? ((entries.push({ ...parsed, bullets: [] })), entries[entries.length - 1]) : undefined;
      continue;
    }
    if (!current) continue;
    if (SUBHEADING.test(line)) { finishBullet(); continue; }
    const bullet = BULLET.exec(line);
    if (bullet) { finishBullet(); pendingBullet = bullet[1]!; }
    else if (pendingBullet !== undefined && /^\s+\S/.test(line) && !line.trimStart().startsWith('<!--')) {
      pendingBullet += ` ${line.trim()}`;
    } else finishBullet();
  }
  finishBullet();
  return entries;
}

/** Entries that represent a shipped deploy and actually carry bullets, newest first. */
export function releasedChangelog(entries: readonly ChangelogEntry[]): ChangelogEntry[] {
  return entries.filter(entry => entry.released && entry.bullets.length > 0);
}

/** The newest shipped entry's version, for "show the What's new panel once per deploy". */
export function latestChangelogVersion(entries: readonly ChangelogEntry[]): string | null {
  return releasedChangelog(entries)[0]?.version ?? null;
}

/**
 * A stable per-DEPLOY signature for an entry: its version plus a cheap hash of the shipped content
 * (title + bullets). Used as the "What's new" seen-key so the panel shows once per deploy (PLAN-v2
 * §11), not once per date — two deploys on the same day (e.g. #5 and #6 both on Oct 5) promote to the
 * same `[YYYY-MM-DD]` version token, so a version-only key would hide the second deploy's panel from
 * anyone who saw the first. Hashing the content distinguishes them; an unchanged entry keeps the same
 * signature and stays suppressed. Pure.
 */
export function changelogSignature(entry: ChangelogEntry): string {
  const text = `${entry.title}\u0001${entry.bullets.join('\u0001')}`;
  let hash = 0x811c9dc5; // FNV-1a (32-bit)
  for (let i = 0; i < text.length; i++) { hash ^= text.charCodeAt(i); hash = Math.imul(hash, 0x01000193); }
  return `${entry.version}:${(hash >>> 0).toString(36)}`;
}

/** The newest shipped entry's per-deploy signature, or null when nothing has shipped. */
export function latestChangelogSignature(entries: readonly ChangelogEntry[]): string | null {
  const entry = releasedChangelog(entries)[0];
  return entry ? changelogSignature(entry) : null;
}

const ISO_DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Promote the collecting `## [Unreleased]` section to a dated milestone and open a fresh empty
 * Unreleased above it, so the next deploy's "What's new" panel (newest *shipped* entry) shows this
 * deploy's bullets. Pure: returns the new markdown and never mutates input. Run at a milestone deploy
 * via tools/changelog/release.mjs. Throws if there is no Unreleased heading or the date is malformed.
 */
/** Bullets for work that is not live yet (behind a preview flag or local-only): kept in Unreleased on release. */
export const HELD_BULLET = /^-\s+(?:(?:local\s+)?graphics preview\b|locally\b|in local play\b|in the gated\b|experimental\b)/i;

export function promoteUnreleased(markdown: string, milestone: string, date = new Date().toISOString().slice(0, 10)): string {
  if (!ISO_DATE_ONLY.test(date) || Number.isNaN(Date.parse(date))) throw new Error(`Invalid release date: ${date} (want YYYY-MM-DD)`);
  const lines = markdown.split(/\r?\n/);
  const idx = lines.findIndex(line => /^##\s+\[Unreleased\]\s*$/i.test(line));
  if (idx < 0) throw new Error('No "## [Unreleased]" heading found in CHANGELOG.md');
  const title = milestone.trim();
  const dated = `## [${date}]${title ? ` — ${title}` : ''}`;
  let end = lines.findIndex((line, i) => i > idx && /^##\s/.test(line));
  if (end < 0) end = lines.length;
  // Split the Unreleased body: preview/local-only bullets (HELD_BULLET, with their continuation
  // lines) stay under a fresh Unreleased; everything else moves to the dated milestone.
  const held: string[] = [], shipped: string[] = [];
  let heading = '', heldHeading = '', shippedHeading = '', target: string[] | null = null;
  for (const line of lines.slice(idx + 1, end)) {
    if (/^###\s/.test(line)) { heading = line; target = null; continue; }
    if (/^-\s/.test(line)) {
      target = HELD_BULLET.test(line) ? held : shipped;
      if (target === held && heldHeading !== heading) { held.push('', heading); heldHeading = heading; }
      if (target === shipped && shippedHeading !== heading) { shipped.push('', heading); shippedHeading = heading; }
      target.push(line); continue;
    }
    if (target && /^\s+\S/.test(line)) { target.push(line); continue; }
    target = null;
  }
  const section = ['## [Unreleased]', ...held, '', dated, ...shipped, ''];
  lines.splice(idx, end - idx, ...section);
  return lines.join('\n');
}
