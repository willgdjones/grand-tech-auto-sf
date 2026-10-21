import { flags } from '@gtasf/shared/flags';
import type { Env } from '../env';
import { admissionJson, smallJson } from '../world/admission/http';

/** Capture interest only. Confirmation and launch email delivery remain a separate double-opt-in step. */
export async function waitlistResponse(request: Request, env: Env): Promise<Response> {
  if (!flags.waitlist) return admissionJson({ error: 'Signup unavailable' }, 503);
  if (request.method !== 'POST') return admissionJson({ error: 'POST required' }, 405);
  const body = await smallJson(request);
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return admissionJson({ error: 'Enter a valid email address' }, 400);
  const source = body?.source === 'queue' ? 'queue' : 'launch';
  try {
    await env.DB.prepare('INSERT INTO waitlist_signups(email,source,status,created_at) VALUES (?, ?, ?, ?) ON CONFLICT(email) DO NOTHING')
      .bind(email, source, 'pending', new Date().toISOString()).run();
  } catch { return admissionJson({ error: 'Signup is temporarily unavailable. Please try again.' }, 503); }
  // Identical reply for existing and new addresses; this endpoint sends no email.
  return admissionJson({ accepted: true });
}
