/**
 * Verification email (emailCapture, gtasf-1aon). Founder, Oct 6: it landed in Gmail spam, so it is now a short,
 * personal note: plain text with a matching minimal HTML part, no images, no tracking, exactly one link (the
 * gtasf.com magic link). The address and code never appear in any log.
 */
import { EMAIL_CODE_TTL_MIN } from '@gtasf/shared/email/contract';

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);


/** Build the verification email. `link` is the absolute magic-link URL (origin + /api/email/verify?token=). */
export function verificationEmail(code: string, link: string): { subject: string; html: string; text: string } {
  const subject = `Your GTA SF code is ${code}`;
  const lines = [
    `Hi, your GTA SF code is ${code}. It works for ${EMAIL_CODE_TTL_MIN} minutes.`,
    'Type it in the game, or open this link on the device you were playing on:',
  ];
  const text = [...lines, link, '', 'Will', '(If you didn\'t ask for this, just ignore it.)'].join('\n');
  const html = `<!doctype html><html lang="en"><body style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#111">`
    + `<p>Hi, your GTA SF code is <strong>${escapeHtml(code)}</strong>. It works for ${EMAIL_CODE_TTL_MIN} minutes.</p>`
    + `<p>Type it in the game, or open this link on the device you were playing on:<br><a href="${escapeHtml(link)}">${escapeHtml(link)}</a></p>`
    + `<p>Will</p><p style="color:#666;font-size:13px">(If you didn't ask for this, just ignore it.)</p></body></html>`;
  return { subject, html, text };
}
