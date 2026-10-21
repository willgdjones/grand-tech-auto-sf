import { parseOnboarding, serializeOnboarding, type OnboardingState } from '@gtasf/shared/onboarding/state';

/** The player's persisted onboarding progress, or null if they have never saved any (brand-new device,
 *  or an older device that predates onboarding). The caller decides fresh-vs-returning from that. */
export async function getOnboardingState(db: D1Database, deviceId: string): Promise<OnboardingState | null> {
  const row = await db.prepare('SELECT state FROM onboarding_state WHERE device_id=?').bind(deviceId).first<{ state: string }>();
  return row ? parseOnboarding(row.state) : null;
}

/** Upsert the player's onboarding progress. State is re-serialized from the parsed form, so only the
 *  known fields are stored — a client cannot smuggle extra data into the row. `now` is the server
 *  request-start time: a slow older request must not undo a newer save. A later replay still wins. */
export async function saveOnboardingState(db: D1Database, deviceId: string, state: OnboardingState, now: number): Promise<void> {
  await db.prepare(`INSERT INTO onboarding_state(device_id,state,updated_at) VALUES(?,?,?)
    ON CONFLICT(device_id) DO UPDATE SET state=excluded.state, updated_at=excluded.updated_at
    WHERE excluded.updated_at >= onboarding_state.updated_at`)
    .bind(deviceId, serializeOnboarding(state), now).run();
}
