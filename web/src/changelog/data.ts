import { CHANGELOG_SOURCE } from './source.generated';
import { latestChangelogSignature, latestChangelogVersion, parseChangelog, releasedChangelog, type ChangelogEntry } from '@gtasf/shared/changelog/parse';

export type { ChangelogEntry };

/** Every entry as authored, newest first, including the Unreleased collector. Module-private:
 *  only the derived `releasedEntries` / `latestVersion` below are consumed elsewhere. */
const changelogEntries: ChangelogEntry[] = parseChangelog(CHANGELOG_SOURCE);

/** Shipped, non-empty entries for display (the /changelog page and the panel). */
export const releasedEntries: ChangelogEntry[] = releasedChangelog(changelogEntries);

/** The newest shipped version (display + the /changelog route). */
export const latestVersion: string | null = latestChangelogVersion(changelogEntries);

/** Per-deploy signature of the newest shipped entry — the What's new "seen" key, so the panel shows
 *  once per deploy even when two deploys land on the same date (PLAN-v2 §11, gtasf-u59c). */
export const latestSignature: string | null = latestChangelogSignature(changelogEntries);
