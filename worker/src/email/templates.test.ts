import { expect, it } from 'vitest';
import { verificationEmail } from './templates';
import { cloudflareEmailProvider, EMAIL_FROM, EMAIL_REPLY_TO, type SendEmailBinding } from './provider';

// Founder, Oct 6: the first live verification email went to Gmail spam. Keep it short, personal and plain.
const link = 'https://gtasf.com/api/email/verify?token=' + 'a'.repeat(64);

it('is a short personal note: code in the subject, text and HTML say the same, one gtasf.com link, no images', () => {
  const { subject, text, html } = verificationEmail('586157', link);
  expect(subject).toBe('Your GTA SF code is 586157');
  expect(text.split('\n').filter(Boolean).length).toBeLessThanOrEqual(5);
  for (const part of [text, html]) { expect(part).toContain('586157'); expect(part).toContain(link); }
  const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map(m => m[1]);
  expect(hrefs).toEqual([link]);
  expect(hrefs.every(h => h!.startsWith('https://gtasf.com/'))).toBe(true);
  expect(html).not.toMatch(/<img|background:url|<table/i);
});

it('sends as Will from GTA SF with replies to the founder', async () => {
  let sent: Parameters<SendEmailBinding['send']>[0] | undefined;
  await cloudflareEmailProvider({ async send(message) { sent = message; return { messageId: 'x' }; } })
    .send({ to: 'founder@example.com', ...verificationEmail('123456', link) });
  expect(EMAIL_FROM).toEqual({ email: 'will@gtasf.com', name: 'Will from GTA SF' });
  expect(sent?.from).toEqual(EMAIL_FROM);
  expect(sent?.replyTo).toBe(EMAIL_REPLY_TO);
  expect(EMAIL_REPLY_TO).toBe('reply@example.com');
});
