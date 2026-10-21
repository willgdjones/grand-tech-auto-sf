// Promote the collecting `## [Unreleased]` section of CHANGELOG.md into a dated milestone and open a
// fresh empty Unreleased, so the next deploy's in-game "What's new" panel surfaces this deploy's
// bullets (PLAN-v2 §11). Run at each milestone deploy, BEFORE build-web.mjs:
//   npx tsx tools/changelog/release.mjs "Tech Week v2" [YYYY-MM-DD]
// Reuses the single shared parser's promoteUnreleased (no duplicated logic) and regenerates the
// embedded source. Run with tsx (devDep) so it can import the TypeScript source.
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HELD_BULLET, parseChangelog, promoteUnreleased } from '../../shared/changelog/parse.ts';

const repoRoot = resolve(fileURLToPath(new URL('../../', import.meta.url)));
const changelog = resolve(repoRoot, 'CHANGELOG.md');

const milestone = process.argv[2];
const date = process.argv[3];
if (!milestone) {
  console.error('Usage: npx tsx tools/changelog/release.mjs "<milestone>" [YYYY-MM-DD]');
  process.exit(1);
}

const markdown = await readFile(changelog, 'utf8');
// Refuse to promote an empty [Unreleased]: it would create a bullet-less dated entry that
// releasedChangelog() filters out, so the in-game "What's new" would silently fall back to the
// PREVIOUS deploy's entry (stale). Catches an accidental double-promote or a release with no new
// bullets before it ships (gtasf-changelog-promote-deploy4-g7nv).
const unreleased = parseChangelog(markdown).find(entry => entry.version.toLowerCase() === 'unreleased');
const shippable = (markdown.split(/^## /m).find(part => /^\[Unreleased\]/i.test(part)) ?? '').split('\n').filter(line => /^-\s/.test(line) && !HELD_BULLET.test(line));
if (!unreleased || unreleased.bullets.length === 0 || shippable.length === 0) {
  console.error('changelog: [Unreleased] has no bullets to promote — refusing to create an empty milestone (it would hide this deploy\'s "What\'s new"). Add CHANGELOG entries first, or check it was not already promoted.');
  process.exit(1);
}
const next = promoteUnreleased(markdown, milestone, date); // throws on no Unreleased / bad date
await writeFile(changelog, next);
// Keep the embedded module in sync with the promoted CHANGELOG.
await import('./build.mjs');
console.log(`changelog: promoted [Unreleased] → [${date ?? new Date().toISOString().slice(0, 10)}] — ${milestone}`);
