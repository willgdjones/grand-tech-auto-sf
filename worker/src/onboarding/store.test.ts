import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { getOnboardingState, saveOnboardingState } from './store';
import { freshOnboarding, type OnboardingState } from '@gtasf/shared/onboarding/state';

function db(): D1Database {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../../migrations/0024_onboarding.sql', import.meta.url), 'utf8'));
  return {
    prepare(sql: string) {
      const statement = sqlite.prepare(sql);
      let bindings: (string | number | null)[] = [];
      const wrapper = {
        bind(...values: (string | number | null)[]) { bindings = values; return wrapper; },
        async first() { return statement.get(...bindings) ?? null; },
        async all() { return { results: statement.all(...bindings), success: true }; },
        async run() { return { meta: statement.run(...bindings), success: true }; },
      };
      return wrapper;
    },
  } as unknown as D1Database;
}

test('persists and reloads onboarding state per device, upserting on save', async () => {
  const database = db();
  expect(await getOnboardingState(database, 'dev-A')).toBeNull(); // never saved

  const mid: OnboardingState = { step: 'gps', hints: ['firstDrop'], completed: false, skipped: false, emailPrompts: 0 };
  await saveOnboardingState(database, 'dev-A', mid, 1000);
  expect(await getOnboardingState(database, 'dev-A')).toEqual(mid);

  const done: OnboardingState = { step: 'done', hints: ['firstDrop', 'idleNudge'], completed: true, skipped: false, emailPrompts: 0 };
  await saveOnboardingState(database, 'dev-A', done, 2000); // upsert
  expect(await getOnboardingState(database, 'dev-A')).toEqual(done);

  expect(await getOnboardingState(database, 'dev-B')).toBeNull(); // isolated per device
});

test('coerces a corrupt stored row back to a safe fresh state', async () => {
  const database = db();
  await database.prepare('INSERT INTO onboarding_state(device_id,state,updated_at) VALUES(?,?,?)').bind('dev-C', '{not json', 3000).run();
  expect(await getOnboardingState(database, 'dev-C')).toEqual(freshOnboarding());
});

test('late older requests cannot undo saved progress, but a newer explicit replay can', async () => {
  const database = db();
  const completed: OnboardingState = { step: 'done', hints: ['enterCar', 'pitchAngel'], completed: true, skipped: false, emailPrompts: 2 };
  await saveOnboardingState(database, 'dev-race', completed, 2000);
  // Earlier request finishes after the completion save (identity/body/D1 latency).
  await saveOnboardingState(database, 'dev-race', { ...freshOnboarding(), step: 'walk' }, 1000);
  expect(await getOnboardingState(database, 'dev-race')).toEqual(completed);
  expect(await database.prepare('SELECT updated_at FROM onboarding_state WHERE device_id=?')
    .bind('dev-race').first()).toEqual({ updated_at: 2000 });

  const replay = { ...freshOnboarding(), hints: completed.hints, emailPrompts: completed.emailPrompts };
  await saveOnboardingState(database, 'dev-race', replay, 3000);
  expect(await getOnboardingState(database, 'dev-race')).toEqual(replay);
  // A delayed pre-replay completion must not skip the replay either.
  await saveOnboardingState(database, 'dev-race', completed, 2500);
  expect(await getOnboardingState(database, 'dev-race')).toEqual(replay);
});

test('only the known fields are stored (no client-smuggled extras)', async () => {
  const database = db();
  const state = { step: 'walk', hints: [], completed: false, skipped: false, evil: 'x' } as unknown as OnboardingState;
  await saveOnboardingState(database, 'dev-D', state, 4000);
  const row = await database.prepare('SELECT state FROM onboarding_state WHERE device_id=?').bind('dev-D').first<{ state: string }>();
  expect(JSON.parse(row!.state)).toEqual({ step: 'walk', hints: [], completed: false, skipped: false });
});
