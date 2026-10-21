/**
 * Email send provider (emailCapture, gtasf-1aon). A thin interface over outbound email so the verification
 * flow is testable with a fake and swappable at the edge. The real implementation wraps the Cloudflare
 * Email Service `send_email` binding (public beta 2026, no API key; declared as `send_email: [{ name: "EMAIL" }]`
 * in wrangler, from an onboarded domain). When the binding is absent (domain not yet onboarded) the whole
 * feature self-gates OFF — see resolveEmailProvider — so there is never a fake "check your inbox".
 * NEVER log addresses or codes (founder constraint); this layer only forwards an already-prepared message.
 */

/** The subset of the Cloudflare Email Service `send_email` binding we use (structural, to avoid a hard
 *  dependency on a specific @cloudflare/workers-types version while the API is in beta). */
export interface SendEmailBinding {
  send(message: {
    to: string;
    from: { email: string; name?: string };
    replyTo?: string;
    subject: string;
    html: string;
    text: string;
  }): Promise<{ messageId: string }>;
}

export interface OutboundEmail { to: string; subject: string; html: string; text: string; }
export interface EmailProvider { send(message: OutboundEmail): Promise<void>; }

/** Sending identity (founder, Oct 6: inbox placement): a person, not noreply@. Replies go to the founder. */
export const EMAIL_FROM = { email: 'will@gtasf.com', name: 'Will from GTA SF' } as const;
export const EMAIL_REPLY_TO = 'reply@example.com';

/** Real provider over the Cloudflare Email Service binding. */
export function cloudflareEmailProvider(binding: SendEmailBinding): EmailProvider {
  return {
    async send(message) {
      await binding.send({ to: message.to, from: { ...EMAIL_FROM }, replyTo: EMAIL_REPLY_TO, subject: message.subject, html: message.html, text: message.text });
    },
  };
}

/** A fake binding for tests: records what WOULD be sent; never performs a real send. */
export interface FakeSendEmail extends SendEmailBinding { readonly sent: OutboundEmail[]; }
export function fakeSendEmailBinding(): FakeSendEmail {
  const sent: OutboundEmail[] = [];
  return {
    sent,
    async send(message) {
      sent.push({ to: message.to, subject: message.subject, html: message.html, text: message.text });
      return { messageId: `fake-${sent.length}` };
    },
  };
}

/** Resolve the provider from env, or undefined when the binding is absent — the feature then self-gates OFF
 *  (the status endpoint reports available:false and the client shows nothing). */
export function resolveEmailProvider(env: { EMAIL?: SendEmailBinding }): EmailProvider | undefined {
  return env.EMAIL ? cloudflareEmailProvider(env.EMAIL) : undefined;
}
