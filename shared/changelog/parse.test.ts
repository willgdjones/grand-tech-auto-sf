import { describe, expect, it } from 'vitest';
import { changelogSignature, latestChangelogSignature, latestChangelogVersion, parseChangelog, promoteUnreleased, releasedChangelog } from './parse';

const SAMPLE = `# Changelog

Intro paragraph that must be ignored.

## Conventions
- This bullet lives under Conventions and must never appear as an entry.

## [Unreleased]

### Added
- New: hidden angel investors walk the city. [gtasf-5dlu]

## [2026-10-04] — Playtest build

### Added
- Overhead plates show your startup, stage and raised total. [gtasf-5dlu]
- Press F to send feedback with a screenshot. [gtasf-10kp]
### Fixed
- Chat bubbles no longer cover the radar.

## [v1.0] — 2026-10-02 — Launch

### Added
- Drive the real Lombard switchbacks.
`;

it('parses headings, flattens subsections and strips bead tags', () => {
  const entries = parseChangelog(SAMPLE);
  expect(entries.map(entry => entry.version)).toEqual(['Unreleased', '2026-10-04', 'v1.0']);
  const playtest = entries[1]!;
  expect(playtest.date).toBe('2026-10-04');
  expect(playtest.title).toBe('Playtest build');
  expect(playtest.released).toBe(true);
  expect(playtest.bullets).toEqual([
    'Overhead plates show your startup, stage and raised total.',
    'Press F to send feedback with a screenshot.',
    'Chat bubbles no longer cover the radar.',
  ]);
});

it('keeps wrapped release bullets complete and hides dotted or hyphenated bead IDs', () => {
  const entry = parseChangelog(`## [2026-10-04] — First playtest build
### Added
- Spawn at the Ferry Building, walk the Embarcadero, hop in a car and drive the real
  Lombard Street switchbacks. [gtasf-long-bead-1234]
- Read **fresh updates** and the
  [full changelog](/changelog).
  [gtasf-q1no.2]
- A plain bullet. [gtasf-ab12] [gtasf-follow-up-xy99]
`)[0]!;
  expect(entry.bullets).toEqual([
    'Spawn at the Ferry Building, walk the Embarcadero, hop in a car and drive the real Lombard Street switchbacks.',
    'Read **fresh updates** and the [full changelog](/changelog).',
    'A plain bullet.',
  ]);
  // Editorial line wrapping must not make an already-seen release look new.
  const singleLine = parseChangelog(`## [2026-10-04] — First playtest build\n${entry.bullets.map(b => `- ${b}`).join('\n')}`)[0]!;
  expect(changelogSignature(entry)).toBe(changelogSignature(singleLine));
});

it('ends bullet continuations at blank lines, prose, comments and section boundaries', () => {
  const entries = parseChangelog(`## [2026-10-04] — First build
- Keep this
  sentence.

  Unrelated indented notes.
- Another bullet.
Unrelated prose.
  More unrelated notes.
- Before comment.
  <!-- editor-only note -->
  Not part of the bullet.
### Fixed
  Section notes.
- Before heading.
## [2026-10-03] — Earlier build
  Entry notes.
- Last bullet
  at end of file.`);
  expect(entries.map(entry => entry.bullets)).toEqual([
    ['Keep this sentence.', 'Another bullet.', 'Before comment.', 'Before heading.'],
    ['Last bullet at end of file.'],
  ]);
});

it('reads a date that follows the title field and keeps a non-date version token', () => {
  const launch = parseChangelog(SAMPLE)[2]!;
  expect(launch.version).toBe('v1.0');
  expect(launch.date).toBe('2026-10-02');
  expect(launch.title).toBe('Launch');
});

it('never emits the Conventions section or its bullets as an entry', () => {
  expect(parseChangelog(SAMPLE).some(entry => /conventions/i.test(entry.version))).toBe(false);
});

it('treats [Unreleased] as not yet shipped so the What\'s new panel skips it', () => {
  const released = releasedChangelog(parseChangelog(SAMPLE));
  expect(released.map(entry => entry.version)).toEqual(['2026-10-04', 'v1.0']);
  expect(latestChangelogVersion(parseChangelog(SAMPLE))).toBe('2026-10-04');
});

it('returns no latest version for an empty or entry-less changelog', () => {
  expect(latestChangelogVersion(parseChangelog('# Changelog\n\njust prose\n'))).toBeNull();
  expect(latestChangelogVersion(parseChangelog(''))).toBeNull();
});

describe('changelogSignature (once-per-deploy key, not once-per-date)', () => {
  const entry = (version: string, title: string, bullets: string[]) =>
    parseChangelog(`## [${version}]${title ? ` — ${title}` : ''}\n${bullets.map(b => `- ${b}`).join('\n')}\n`)[0]!;

  it('is stable for identical content', () => {
    expect(changelogSignature(entry('2026-10-05', 'A', ['one', 'two'])))
      .toBe(changelogSignature(entry('2026-10-05', 'A', ['one', 'two'])));
  });

  it('differs for two same-date deploys with different bullets (the bug this fixes)', () => {
    const a = changelogSignature(entry('2026-10-05', 'Deploy 5', ['hill jumps']));
    const b = changelogSignature(entry('2026-10-05', 'Deploy 6', ['realistic cars']));
    expect(a).not.toBe(b);
  });

  it('differs when only the bullets change, even with the same version and title', () => {
    expect(changelogSignature(entry('2026-10-05', 'X', ['a'])))
      .not.toBe(changelogSignature(entry('2026-10-05', 'X', ['a', 'b'])));
  });

  it('latestChangelogSignature targets the newest released entry, null when nothing shipped', () => {
    const entries = parseChangelog(SAMPLE);
    expect(latestChangelogSignature(entries)).toBe(changelogSignature(releasedChangelog(entries)[0]!));
    expect(latestChangelogSignature(parseChangelog('# Changelog\n\njust prose\n'))).toBeNull();
  });
});

describe('edge cases (silent-tolerance behaviour pinned)', () => {
  it('ignores an empty bracket heading "## []" and its bullets', () => {
    const entries = parseChangelog('# Changelog\n\n## []\n- orphaned bullet\n');
    expect(entries).toEqual([]);
  });

  it('keeps a bullet that is only a bead tag as an empty string', () => {
    const entries = parseChangelog('## [2026-10-05] — Build\n- [gtasf-xyz1]\n- Real bullet.\n');
    expect(entries[0]!.bullets).toEqual(['', 'Real bullet.']);
  });

  it('parses a whitespace-flanked ASCII hyphen as a field separator, not just em/en-dash', () => {
    const entry = parseChangelog('## [v2.0] - 2026-10-02 - Hyphen launch\n- ok\n')[0]!;
    expect(entry.version).toBe('v2.0');
    expect(entry.date).toBe('2026-10-02'); // date still extracted despite hyphen separators
    expect(entry.title).toBe('Hyphen launch');
  });

  it('preserves inline markdown in bullet text verbatim (rendering happens at display time)', () => {
    const entry = parseChangelog('## [2026-10-05] — Build\n- Raise with **H** and a [link](/changelog).\n')[0]!;
    expect(entry.bullets).toEqual(['Raise with **H** and a [link](/changelog).']);
  });

  it('tolerates CRLF line endings', () => {
    const entry = parseChangelog('## [2026-10-05] — Build\r\n- Works on Windows too.\r\n')[0]!;
    expect(entry.version).toBe('2026-10-05');
    expect(entry.bullets).toEqual(['Works on Windows too.']);
  });

  it('returns no entries for empty or prose-only input', () => {
    expect(parseChangelog('')).toEqual([]);
    expect(releasedChangelog(parseChangelog('# Changelog\n\njust prose, no entries\n'))).toEqual([]);
  });
});

describe('promoteUnreleased', () => {
  it('turns the Unreleased section into a dated milestone with a fresh empty Unreleased above', () => {
    const next = promoteUnreleased(SAMPLE, 'Tech Week v2', '2026-10-05');
    const entries = parseChangelog(next);
    // Fresh empty Unreleased first, then the promoted milestone carrying the former Unreleased bullets.
    expect(entries[0]!.version).toBe('Unreleased');
    expect(entries[0]!.bullets).toEqual([]);
    const promoted = entries[1]!;
    expect(promoted.version).toBe('2026-10-05');
    expect(promoted.title).toBe('Tech Week v2');
    expect(promoted.date).toBe('2026-10-05');
    expect(promoted.bullets).toEqual(['New: hidden angel investors walk the city.']);
    // The What's new panel now surfaces this deploy's entry as the newest shipped one.
    expect(latestChangelogVersion(entries)).toBe('2026-10-05');
    expect(releasedChangelog(entries)[0]!.version).toBe('2026-10-05');
  });

  it('works with no milestone title (date only) and does not mutate the input', () => {
    const before = SAMPLE;
    const next = promoteUnreleased(SAMPLE, '  ', '2026-10-05');
    expect(parseChangelog(next)[1]!.title).toBe('');
    expect(parseChangelog(next)[1]!.version).toBe('2026-10-05');
    expect(SAMPLE).toBe(before); // pure
  });

  it('defaults to today (ISO YYYY-MM-DD) when no date is given', () => {
    const today = new Date().toISOString().slice(0, 10);
    expect(parseChangelog(promoteUnreleased(SAMPLE, 'Daily'))[1]!.date).toBe(today);
  });

  it('throws when there is no Unreleased heading or the date is malformed', () => {
    expect(() => promoteUnreleased('# Changelog\n\n## [2026-10-01] — Launch\n- ok\n', 'X')).toThrow(/Unreleased/);
    expect(() => promoteUnreleased(SAMPLE, 'X', 'Oct 5')).toThrow(/Invalid release date/);
  });
});
