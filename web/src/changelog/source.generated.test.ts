import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { parseChangelog, releasedChangelog } from '@gtasf/shared/changelog/parse';
import { CHANGELOG_SOURCE } from './source.generated';

// M8 drift guard. The embedded source feeds the /changelog page and the What's new panel, both of
// which only ever render RELEASED (dated) entries. In this shared checkout many agents append to the
// repo-root CHANGELOG.md's `[Unreleased]` section without re-running build.mjs; that churn is
// harmless because Unreleased is filtered out of display until a milestone deploy runs release.mjs
// (which regenerates). So we assert the embedded source and the live file agree on their SHIPPED
// content — the bytes players actually see — rather than demanding byte-for-byte equality that would
// go red on every Unreleased edit. If this fails, a *released* entry has drifted: run
// `node tools/changelog/build.mjs` and commit web/src/changelog/source.generated.ts.
it('keeps released changelog entries in lockstep with CHANGELOG.md', () => {
  const live = readFileSync(fileURLToPath(new URL('../../../CHANGELOG.md', import.meta.url)), 'utf8');
  expect(releasedChangelog(parseChangelog(CHANGELOG_SOURCE))).toEqual(releasedChangelog(parseChangelog(live)));
});
