import type { AnalyticsEnv } from './analytics/posthog';
import type { SendEmailBinding } from './email/provider';
export interface Env extends AnalyticsEnv {
  /** Cloudflare Email Service `send_email` binding (emailCapture, gtasf-1aon). Optional: absent until the
   *  sending domain is onboarded (wrangler email sending enable gtasf.com), which self-gates the feature OFF. */
  EMAIL?: SendEmailBinding;
  ENVIRONMENT: 'local' | 'test' | 'staging' | 'production';
  WORLD: DurableObjectNamespace;
  LOBBY: DurableObjectNamespace;
  WORLD_CAPACITY?: string;
  LAUNCH_MODE?: 'open' | 'waitlist' | 'invite';
  INVITE_CODE?: string;
  LEDGER: DurableObjectNamespace;
  DB: D1Database;
  ASSETS: R2Bucket;
  WORLD_ROAD_GRAPH_KEY?: string;
  WORLD_ROAD_GRAPH_SHA256?: string;
  JOBS: Queue<Job>;
  TYPESAFE_API_KEY?: string;
  /** OpenRouter (OpenAI-compatible) key for all LLM calls — event extraction, image prescreen. */
  OPENROUTER_API_KEY?: string;
  /** ElevenLabs Scribe key for the server speech-to-text fallback (voice chat, gtasf-slzj); not provisioned yet. */
  ELEVENLABS_API_KEY?: string;
  /** Cloudflare Workers AI binding (wrangler [ai] binding = "AI"); spoken-bubble STT (Whisper); prepare.ts binds it in production when voiceCaptions is reviewed. */
  AI?: Ai;
  /** Proximity voice (flag proximityVoice): Cloudflare Realtime SFU app id (var) and token (secret). */
  REALTIME_APP_ID?: string;
  REALTIME_APP_TOKEN?: string;
  /** Optional Cloudflare TURN key; without it clients get the public Cloudflare STUN server only. */
  REALTIME_TURN_KEY_ID?: string;
  REALTIME_TURN_KEY_TOKEN?: string;
  // Production uses the live keys; non-production uses the STRIPE_TEST_* keys only (see outbid/stripeEnv.ts).
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  STRIPE_PUBLISHABLE_KEY?: string;
  STRIPE_TEST_SECRET_KEY?: string;
  STRIPE_TEST_WEBHOOK_SECRET?: string;
  STRIPE_TEST_PUBLISHABLE_KEY?: string;
  /** Bearer token for the community-event admin endpoints; admin stays disabled without it. */
  ADMIN_TOKEN?: string;
  /** HMAC pepper (salt) for account-recovery code hashes (gtasf-17df). Required in production; a
   *  fixed dev fallback is used when ENVIRONMENT !== 'production' so local recovery works keyless. */
  RECOVERY_PEPPER?: string;
  /** Secret salt for the hashed per-IP rate-limit keys (referrals/ipLimiter.ts, gtasf-cnjpc review). Without it the keys
   *  fall back to a public per-day salt, which a day's 2^32 IPv4 brute force can reverse. Wrangler secret in prod. */
  IP_HASH_SECRET?: string;
}
export type Job = { type: 'refresh-events' } | { type: 'reprice' } | { type: 'moderate-image'; key: string; rentalId: string };
