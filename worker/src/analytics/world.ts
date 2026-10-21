import { flags } from '@gtasf/shared/flags';
import { cleanAnalyticsContext, type AnalyticsContext } from '@gtasf/shared/analytics';
import { captureConfirmedPlay, type AnalyticsServerContext } from './xConversions';
import type { AnalyticsEnv } from './posthog';

/** Accepted World peers only. Durable uniqueness survives reconnects and DO restarts. */
export class WorldAnalytics {
  constructor(private readonly storage: Pick<DurableObjectStorage, 'sql'>, private readonly env: AnalyticsEnv) {
    storage.sql.exec('CREATE TABLE IF NOT EXISTS world_analytics_plays (conversion_id TEXT PRIMARY KEY, session_id INTEGER NOT NULL UNIQUE, recorded_at INTEGER NOT NULL)');
  }
  async joined(sessionId: number, server: AnalyticsServerContext | undefined, input: AnalyticsContext | undefined): Promise<void> {
    if ((!flags.posthogAnalytics && !flags.xAdsPixel) || server?.optedOut) return;
    const context = cleanAnalyticsContext(input);
    if (!context?.playConversionId) return;
    const now = Date.now();
    this.storage.sql.exec('DELETE FROM world_analytics_plays WHERE recorded_at<?', now - 30 * 86400_000);
    const inserted = this.storage.sql.exec<{ conversion_id: string }>(
      'INSERT OR IGNORE INTO world_analytics_plays (conversion_id,session_id,recorded_at) VALUES (?,?,?) RETURNING conversion_id',
      context.playConversionId, sessionId, now,
    ).toArray();
    if (!inserted.length) return;
    await captureConfirmedPlay(this.env, server ?? {}, context);
  }
}
