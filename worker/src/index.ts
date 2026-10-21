import { flags } from '@gtasf/shared/flags';
import type { Env, Job } from './env';
import { eventsResponse } from './events/api';
import { handleEventSubmissionRequest } from './events/routes';
import { handleFeedbackRequest } from './feedback/routes';
import { handlePlaceStampsRequest } from './places/stamps';
import { handleTimeTrialRequest, purgeOldTimeTrials } from './founder/timeTrialRoutes';
import { sweepExpiredAcquisitions } from './founder/acquihire';
import { refreshOfficialEvents } from './events/refresh';
import { handleGtmRequest } from './gtm/routes';
import { handleOrganiserTrackRequest } from './gtm/organiserTrack';
import { handleLoadingBeacon } from './analytics/loadingBeacon';
import { handleNetBeacon } from './analytics/netBeacon';
import { handleAnalyticsRequest } from './analytics/routes';
import { handleAdmissionRequest } from './world/admission/routes';
import { handleOutbidRequest } from './outbid/routes';
import { serveMapAsset } from './map/assets';
import { handleFundingRequest } from './funding/routes';
import { handleCombatRequest } from './combat/routes';
import { handleRecoveryRequest } from './recovery/routes';
import { handleOnboardingRequest } from './onboarding/routes';
import { handleEmailRequest } from './email/routes';
import { handleVoiceFeedback, handleVoiceRequest } from './voice/realtime';
import { handleFriendsRequest } from './friends/routes';
import { handleSponsoredAngelsRequest } from './sponsoredAngels/routes';
import { createSponsoredAngelCheckout } from './ledger/sponsoredAngelCheckout';
import { handleModerateImage } from './media/review/moderateImage';
import { handleDropsRequest } from './funding/drops';
import { createFundDropSponsorCheckout } from './ledger/fundDropSponsorCheckout';
import { handleReferralRequest } from './referrals/routes';
import { handleWeatherRequest } from './weather';
import { worldInstanceName } from './world/zoneRouting';
import { purgeReportCaptions } from './voice/captions';
import { purgeVoiceMetricSalts } from './voice/metrics';
export { WorldDO } from './world/WorldDO';
export { LobbyDO } from './world/LobbyDO';
export { LedgerDO } from './ledger/LedgerDO';
export default {
  async fetch(request: Request, env: Env, context: ExecutionContext): Promise<Response> {
    const { pathname } = new URL(request.url);
    const map = await serveMapAsset(request, env.ASSETS);
    if (map) return map;
    const admission = await handleAdmissionRequest(request, env);
    if (admission) return admission;
    const analytics = await handleAnalyticsRequest(request, env, context);
    if (analytics) return analytics;
    if (pathname === '/api/health') return Response.json({ ok: true, game: 'GTASF', environment: env.ENVIRONMENT, flags });
    if (pathname === '/api/world' && flags.multiplayer) {
      // zonedWorld off → the single 'sf' world (unchanged); on → a per-cell WorldDO
      // instance for the connection's home zone (docs/engineering/zoned-world.md).
      const instance = worldInstanceName(new URL(request.url), flags.zonedWorld);
      return env.WORLD.get(env.WORLD.idFromName(instance)).fetch(request);
    }
    if (pathname === '/api/events') {
      return eventsResponse(env);
    }
    const submission = await handleEventSubmissionRequest(request, env);
    if (submission) return submission;
    const voiceFeedback = await handleVoiceFeedback(request, env);
    if (voiceFeedback) return voiceFeedback;
    const placeStamps = await handlePlaceStampsRequest(request, env);
    if (placeStamps) return placeStamps;
    const timeTrials = await handleTimeTrialRequest(request, env);
    if (timeTrials) return timeTrials;
    const feedback = await handleFeedbackRequest(request, env);
    if (feedback) return feedback;
    const loadingBeacon = await handleLoadingBeacon(request, env);
    if (loadingBeacon) return loadingBeacon;
    const netBeacon = await handleNetBeacon(request, env);
    if (netBeacon) return netBeacon;
    const organiserTrack = await handleOrganiserTrackRequest(request, env);
    if (organiserTrack) return organiserTrack;
    const gtm = await handleGtmRequest(request, env);
    if (gtm) return gtm;
    const outbid = await handleOutbidRequest(request, env);
    if (outbid) return outbid;
    const funding = await handleFundingRequest(request, env);
    if (funding) return funding;
    const combat = await handleCombatRequest(request, env);
    if (combat) return combat;
    const recovery = await handleRecoveryRequest(request, env);
    if (recovery) return recovery;
    const onboarding = await handleOnboardingRequest(request, env);
    if (onboarding) return onboarding;
    const email = await handleEmailRequest(request, env);
    if (email) return email;
    const voice = await handleVoiceRequest(request, env);
    if (voice) return voice;
    const friends = await handleFriendsRequest(request, env);
    if (friends) return friends;
    // Inject the real USD Checkout; the route still guards on checkoutConfigured(env), so this is inert
    // (never charges) until the test webhook secret is set locally / the founder enables production.
    const sponsoredAngels = await handleSponsoredAngelsRequest(request, env, {
      checkout: createSponsoredAngelCheckout(env, request.headers.get('Origin') ?? new URL(request.url).origin),
    });
    if (sponsoredAngels) return sponsoredAngels;
    const drops = await handleDropsRequest(request, env, {
      checkout: createFundDropSponsorCheckout(env, request.headers.get('Origin') ?? new URL(request.url).origin),
    });
    if (drops) return drops;
    const referrals = await handleReferralRequest(request, env);
    if (referrals) return referrals;
    const weather = await handleWeatherRequest(request, context);
    if (weather) return weather;
    return Response.json({ error: 'Not found' }, { status: 404 });
  },
  async scheduled(controller: ScheduledController, env: Env): Promise<void> {
    if (controller.cron === '0 */3 * * *' && flags.eventsRefresh) await env.JOBS.send({ type: 'refresh-events' });
    // Spoken bubbles: report-attached caption transcripts are kept 7 days (gtasf-qjja).
    if (controller.cron === '0 */3 * * *' && flags.voiceCaptions) await purgeReportCaptions(env.DB, Date.now()).catch(error => console.warn('Caption purge failed', error instanceof Error ? error.message : 'unknown'));
    // Voice metrics: forget finished days' salts so stored device hashes become unlinkable.
    if (controller.cron === '0 */3 * * *' && (flags.proximityVoice || flags.voiceCaptions)) await purgeVoiceMetricSalts(env.DB, Date.now()).catch(() => {});
    // Time trials: the board is daily; drop past days' rows (ghost blobs) so they don't accumulate (review fix 3).
    if (controller.cron === '0 */3 * * *' && flags.timeTrials) await purgeOldTimeTrials(env.DB, Date.now()).catch(error => console.warn('Time-trial purge failed', error instanceof Error ? error.message : 'unknown'));
    // Acqui-hire safety net: refund any escrow whose run was lost (DO eviction) once its deadline has passed. Runs whenever
    // economy v3 is on (review E-M1), so rolling the acquihireQuest/missions flags back never strands escrowed money.
    if (controller.cron === '0 */3 * * *' && flags.economyV3) await sweepExpiredAcquisitions(env.DB, Date.now()).catch(error => console.warn('Acquihire sweep failed', error instanceof Error ? error.message : 'unknown'));
    if (controller.cron === '0 8 * * *' && flags.rentals) await env.JOBS.send({ type: 'reprice' });
  },
  async queue(batch: MessageBatch<Job>, env: Env): Promise<void> {
    let refreshed=false;
    for (const message of batch.messages) {
      if (message.body.type === 'moderate-image') {
        // Ad-logo advisory prescreen (gtasf-ad-moderation-consumer-ri4a). Feature off -> drop the job
        // (uploads are gated by the same flag, so none are produced) rather than retry it forever.
        if (!flags.moderation) { message.ack(); continue; }
        try { await handleModerateImage(message.body.key, env); message.ack(); }
        catch (error) { console.warn('Ad image moderation failed', error instanceof Error ? error.message : 'unknown'); message.retry({ delaySeconds: 120 }); }
        continue;
      }
      if(message.body.type!=='refresh-events'||!flags.eventsRefresh){message.retry({delaySeconds:300});continue;}
      try{
        if(!refreshed){const result=await refreshOfficialEvents(env.DB);console.log('Tech Week events refreshed',result);refreshed=true;}
        message.ack();
      }catch(error){console.warn('Event refresh failed; retaining previous calendar',error instanceof Error?error.message:'Unknown feed error');message.retry({delaySeconds:300});}
    }
  },
} satisfies ExportedHandler<Env, Job>;
