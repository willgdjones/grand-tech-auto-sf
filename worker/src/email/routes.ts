/**
 * Email-capture + verification endpoints (emailCapture, gtasf-1aon, founder 2026-10-04), behind
 * `flags.emailCapture` AND a configured Cloudflare Email Service binding (resolveEmailProvider):
 *   GET  /api/email/status                 -> { available, pending, verified, rewarded }
 *   POST /api/email/start   { email }      -> { sent, resendAfterSec, expiresInMin }  (sends code + link)
 *   POST /api/email/verify  { code }       -> { verified, reward? , attemptsLeft? }
 *   GET  /api/email/verify?token=...       -> HTML page (the magic link; verifies the originating device)
 *
 * Direct-D1 so it can issue the gtasf_device cookie, mirroring handleRecoveryRequest. The address and the
 * code are NEVER logged. Only hashed code/link tokens are stored. The verified-founder reward (cosmetic
 * tick + one-time cheque) is recorded here (rewarded_at, one-per-profile + one-per-address); the funding
 * credit is inserted atomically with the address claim by reward.ts. Funding profiles expose only the
 * verifiedFounder boolean; pane 1 confirms the cheque size. The client fires PostHog `email_captured`.
 */
import { flags } from '@gtasf/shared/flags';
import {
  EMAIL_CODE_TTL_MIN, EMAIL_RESEND_SEC, EMAIL_MAX_ATTEMPTS,
  isPlausibleEmail, isWellFormedEmailCode, type EmailStatus, type EmailStartResponse, type EmailVerifyResponse,
} from '@gtasf/shared/email/contract';
import type { Env } from '../env';
import { ensureFundingDevice, fundingSameOrigin } from '../funding/identity';
import { referralRateLimit } from '../referrals/store';
import { resolveEmailProvider, type EmailProvider } from './provider';
import { verificationEmail } from './templates';
import {
  getCapture, startCapture, bumpAttempts, markVerified, verifyLinkToken,
  hashEmail, hashCode, hashLinkToken, generateEmailCode, generateLinkToken,
} from './store';
import { grantEmailReward } from './reward';
import { hashedIpKey } from '../referrals/ipLimiter';

function json(value: unknown, status = 200, cookie?: string): Response {
  return Response.json(value, { status, headers: { 'Cache-Control': 'no-store', ...(cookie ? { 'Set-Cookie': cookie } : {}) } });
}
async function readBody(request: Request): Promise<Record<string, unknown>> {
  try { const v = await request.json(); return v && typeof v === 'object' ? v as Record<string, unknown> : {}; }
  catch { return {}; }
}
function htmlPage(title: string, body: string, status = 200): Response {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title></head><body style="margin:0;background:#10281e;color:#fff;font-family:Arial,Helvetica,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center">
<div style="max-width:420px;padding:28px;text-align:center;background:#0b1f17;border:2px solid #000">
<div style="font-size:11px;font-weight:800;letter-spacing:.14em;color:#f6a81e;text-transform:uppercase">Grand Tech Auto &middot; San Francisco</div>
<h1 style="margin:10px 0 6px;color:#f6a81e;text-transform:uppercase;font-family:'Arial Narrow',Arial,sans-serif">${title}</h1>
<p style="font-size:14px;color:#dfe8e2">${body}</p>
<a href="/" style="display:inline-block;margin-top:14px;background:#f6a81e;color:#10281e;font-weight:900;text-decoration:none;padding:12px 22px;border:2px solid #000">Back to GTASF</a>
</div></body></html>`;
  return new Response(html, { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
}

export async function handleEmailRequest(request: Request, env: Env, provider?: EmailProvider): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;
  if (!path.startsWith('/api/email/')) return null;

  const send = provider ?? resolveEmailProvider(env);
  const available = flags.emailCapture && send != null;

  // The magic link is a GET opened from the inbox (its token is the authorization; no cookie/same-origin).
  if (path === '/api/email/verify' && request.method === 'GET') {
    if (!available) return htmlPage('Not available', 'Email verification is not enabled right now.');
    const token = url.searchParams.get('token') ?? '';
    const now = Date.now();
    try {
      const deviceId = token ? await verifyLinkToken(env.DB, await hashLinkToken(token), now) : null;
      if (!deviceId) return htmlPage('Link expired', 'This verification link is invalid or has expired. Open the game and request a new one.');
      await grantEmailReward(env.DB, deviceId, now);
      return htmlPage('Email verified', 'Head back to GTASF on the device where you started to see your Verified Founder reward. Save a recovery code in Game options to bring your startup to another device.');
    } catch {
      return htmlPage('Try again in the game', 'Email verification is temporarily unavailable. Return to the game on the device where you started to check your status or request a new link.', 503);
    }
  }

  if (!flags.emailCapture) return json({ error: 'Email capture is disabled' }, 503);
  if (!fundingSameOrigin(request)) return json({ error: 'Same-origin request required' }, 403);
  const now = Date.now();

  try {
    if (path === '/api/email/status' && request.method === 'GET') {
      const identity = await ensureFundingDevice(request, env.DB, now);
      let row = await getCapture(env.DB, identity.deviceId);
      if (row?.verified_at != null) {
        // Retry an interrupted funding write even after the one-use code/link
        // was consumed. Cookie identity cannot verify an unverified address.
        await grantEmailReward(env.DB, identity.deviceId, now);
        row = await getCapture(env.DB, identity.deviceId);
      }
      const status: EmailStatus = {
        available,
        pending: available && row != null && row.verified_at == null && row.code_hash != null,
        verified: row?.verified_at != null,
        rewarded: row?.rewarded_at != null,
      };
      return json(status, 200, identity.cookie);
    }

    if (path === '/api/email/start' && request.method === 'POST') {
      if (!available) return json({ error: 'Email capture is not available' }, 503);
      const identity = await ensureFundingDevice(request, env.DB, now);
      const client = request.headers.get('CF-Connecting-IP') ?? 'local';
      const email = String((await readBody(request)).email ?? '').trim().toLowerCase();
      if (!isPlausibleEmail(email)) return json({ error: 'Enter a valid email address' }, 400, identity.cookie);
      const emailHash = await hashEmail(email);
      // Abuse caps: per IP and per address. Mirrors the recovery route's per-IP lockout idiom.
      if (!await referralRateLimit(env.DB, await hashedIpKey('email-ip:', 'gtasf-email', client, now, env.IP_HASH_SECRET), 10, 600_000, now) // gtasf-cnjpc: no raw IP
        || !await referralRateLimit(env.DB, `email-addr:${emailHash}`, 5, 3_600_000, now)) {
        return json({ error: 'Too many attempts. Try again in a few minutes.' }, 429, identity.cookie);
      }
      const existing = await getCapture(env.DB, identity.deviceId);
      // Resend throttle (UX): one send per EMAIL_RESEND_SEC. Identical reply either way (no enumeration).
      const resend: EmailStartResponse = { sent: true, resendAfterSec: EMAIL_RESEND_SEC, expiresInMin: EMAIL_CODE_TTL_MIN };
      if (existing?.verified_at != null) return json(resend, 200, identity.cookie); // already verified: no-op
      if (existing && now - existing.last_sent_at < EMAIL_RESEND_SEC * 1000) return json(resend, 200, identity.cookie);

      const code = generateEmailCode();
      const token = generateLinkToken();
      const expiresAt = now + EMAIL_CODE_TTL_MIN * 60_000;
      const started = await startCapture(env.DB, {
        deviceId: identity.deviceId, email, emailHash,
        codeHash: await hashCode(identity.deviceId, code), linkHash: await hashLinkToken(token), expiresAt, now,
      });
      if (!started) return json(resend, 200, identity.cookie);
      const link = `${url.origin}/api/email/verify?token=${token}`;
      const message = verificationEmail(code, link);
      await send!.send({ to: email, subject: message.subject, html: message.html, text: message.text });
      return json(resend, 200, identity.cookie);
    }

    if (path === '/api/email/verify' && request.method === 'POST') {
      if (!available) return json({ error: 'Email capture is not available' }, 503);
      const identity = await ensureFundingDevice(request, env.DB, now);
      const code = String((await readBody(request)).code ?? '').trim();
      if (!isWellFormedEmailCode(code)) return json({ verified: false, error: 'Enter the 6-digit code' } as EmailVerifyResponse, 400, identity.cookie);
      const row = await getCapture(env.DB, identity.deviceId);
      if (row?.verified_at != null) {
        return json({ verified: true, reward: await grantEmailReward(env.DB, identity.deviceId, now) } as EmailVerifyResponse, 200, identity.cookie);
      }
      if (!row || row.code_hash == null || row.expires_at == null || row.expires_at <= now) {
        return json({ verified: false, error: 'That code has expired. Request a new one.' } as EmailVerifyResponse, 400, identity.cookie);
      }
      if (row.attempts >= EMAIL_MAX_ATTEMPTS) {
        return json({ verified: false, attemptsLeft: 0, error: 'Too many attempts. Request a new code.' } as EmailVerifyResponse, 429, identity.cookie);
      }
      if ((await hashCode(identity.deviceId, code)) !== row.code_hash) {
        const attempts = await bumpAttempts(env.DB, identity.deviceId, row, now);
        return json({ verified: false, attemptsLeft: Math.max(0, EMAIL_MAX_ATTEMPTS - attempts), error: 'That code is not right.' } as EmailVerifyResponse, 400, identity.cookie);
      }
      if (!await markVerified(env.DB, identity.deviceId, row, now)) {
        return json({ verified: false, error: 'That code has expired or changed. Use the latest code or request a new one.' } as EmailVerifyResponse, 400, identity.cookie);
      }
      const reward = await grantEmailReward(env.DB, identity.deviceId, now);
      return json({ verified: true, reward } as EmailVerifyResponse, 200, identity.cookie);
    }

    return json({ error: 'Not found' }, 404);
  } catch {
    return json({ error: 'Email capture is temporarily unavailable' }, 503);
  }
}
