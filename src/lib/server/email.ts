/**
 * Email delivery abstraction.
 *
 * The site never fakes delivery: `sendEmail` returns a result and every
 * caller surfaces failures honestly (e.g. "we couldn't send the email right
 * now — try again later" instead of a pretend success).
 *
 * Transports (EMAIL_TRANSPORT):
 *   console — print to the server log (default; dev only, nothing is sent)
 *   smtp    — SMTP via nodemailer (dev/self-hosted; not available on
 *             Cloudflare Workers — use `http` there instead)
 *   http    — generic transactional HTTP API (Resend-compatible:
 *             POST {url}/emails with `Authorization: Bearer {key}` and a
 *             body of {from, to, subject, html})
 *
 * In production without EMAIL_TRANSPORT configured, sends fail loudly so a
 * "verification email sent" message can never be a lie.
 */
import type { APIContext } from 'astro';

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface EmailResult {
  ok: boolean;
  transport: 'console' | 'smtp' | 'http' | 'unconfigured';
  /** Human-readable reason when !ok (safe to surface to users). */
  reason?: string;
}

const TEMPLATE_TTL_VERIFY_HOURS = 24;
const TEMPLATE_TTL_RESET_HOURS = 1;

// ---------------------------------------------------------------------------
// Branded templates
// ---------------------------------------------------------------------------

interface TemplateInput {
  to: string;
  /** Absolute verification/reset URL. */
  url: string;
  /** Expiry window in hours, shown in the email body. */
  ttlHours: number;
  base: string;
}

function emailShell(input: TemplateInput, headline: string, bodyHtml: string): EmailMessage {
  const logo = `${input.base}/logo/zenith-logo-600.webp`;
  const fallback = input.url;
  const ttl = input.ttlHours === 1 ? '1 hour' : `${input.ttlHours} hours`;

  const text = `${headline}

${bodyHtml.replace(/<[^>]+>/g, '')}

This link expires in ${ttl}. If the button above doesn't work, copy and paste this URL into your browser:

${fallback}

If you didn't request this email, you can safely ignore it.

— The Zenith team
`;

  const html = `<!doctype html>
<html lang="en">
<body style="margin:0;padding:0;background:#07080c;color:#e8eaf0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#07080c;padding:40px 16px;">
    <tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#0d0f16;border:1px solid #1c2030;border-radius:14px;overflow:hidden;">
        <tr>
          <td align="center" style="padding:36px 32px 8px;">
            <img src="${logo}" alt="Zenith" width="220" style="width:220px;max-width:70%;display:block;margin:0 auto;" />
          </td>
        </tr>
        <tr>
          <td align="center" style="padding:20px 32px 4px;">
            <h1 style="margin:0;font-size:22px;font-weight:700;letter-spacing:-0.01em;">${headline}</h1>
          </td>
        </tr>
        <tr>
          <td style="padding:12px 32px 0;font-size:15px;line-height:1.6;color:#aab1c2;">
            ${bodyHtml}
          </td>
        </tr>
        <tr>
          <td align="center" style="padding:26px 32px 8px;">
            <a href="${fallback}" style="display:inline-block;background:#ffffff;color:#0a0a0d;text-decoration:none;font-weight:600;font-size:15px;padding:12px 28px;border-radius:9px;">Verify email</a>
          </td>
        </tr>
        <tr>
          <td style="padding:8px 32px 0;font-size:13px;line-height:1.6;color:#6b7280;">
            This link expires in ${ttl}. If the button doesn't work, copy and paste this URL into your browser:
            <br />
            <a href="${fallback}" style="color:#c4c4d0;word-break:break-all;">${fallback}</a>
          </td>
        </tr>
        <tr>
          <td style="padding:20px 32px 28px;font-size:12px;line-height:1.6;color:#565e70;">
            If you didn't request this, you can safely ignore this email — no changes have been made to your account.
          </td>
        </tr>
      </table>
      <p style="font-size:11px;color:#3d4454;margin-top:16px;">Zenith · Premium Minecraft client</p>
    </td></tr>
  </table>
</body>
</html>`;

  return { to: input.to, subject: `${headline} — Zenith`, text, html };
}

export function verificationEmail(input: { to: string; url: string; base: string }): EmailMessage {
  const t = emailShell(
    { ...input, ttlHours: TEMPLATE_TTL_VERIFY_HOURS },
    'Verify your email address',
    `Welcome to <strong style="color:#e8eaf0;">Zenith</strong> — you're almost set up. Confirm this email address to activate your account and unlock downloads.`,
  );
  t.subject = 'Verify your Zenith account';
  return t;
}

export function passwordResetEmail(input: { to: string; url: string; base: string }): EmailMessage {
  const t = emailShell(
    { ...input, ttlHours: TEMPLATE_TTL_RESET_HOURS },
    'Reset your password',
    `We received a request to reset the password for <strong style="color:#e8eaf0;">${input.to}</strong>. If this was you, choose a new password using the button below.`,
  );
  t.subject = 'Reset your Zenith password';
  return t;
}

// ---------------------------------------------------------------------------
// Transports
// ---------------------------------------------------------------------------

function consoleSend(message: EmailMessage): EmailResult {
  // eslint-disable-next-line no-console
  console.log(
    `\n[dev-email] To: ${message.to}\n[dev-email] Subject: ${message.subject}\n[dev-email] ${message.text}\n`,
  );
  return { ok: true, transport: 'console' };
}

async function smtpSend(message: EmailMessage): Promise<EmailResult> {
  const env = import.meta.env;
  // Nodemailer is dynamically imported so Cloudflare Workers builds can
  // tree-shake it out (it is only used on Node/dev).
  const { default: nodemailer } = await import('nodemailer');
  const transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: Number(env.SMTP_PORT ?? 587),
    secure: Number(env.SMTP_PORT ?? 587) === 465,
    auth: env.SMTP_USERNAME
      ? { user: env.SMTP_USERNAME, pass: env.SMTP_PASSWORD ?? '' }
      : undefined,
  });
  try {
    await transporter.sendMail({
      from: `"${env.EMAIL_FROM_NAME ?? 'Zenith'}" <${env.EMAIL_FROM ?? 'no-reply@zenith.local'}>`,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
    });
    return { ok: true, transport: 'smtp' };
  } catch (err) {
    return { ok: false, transport: 'smtp', reason: `Email could not be sent (${(err as Error).message}).` };
  }
}

async function httpSend(message: EmailMessage): Promise<EmailResult> {
  const env = import.meta.env;
  const url = env.EMAIL_API_URL;
  const key = env.EMAIL_API_KEY;
  if (!url || !key) {
    return { ok: false, transport: 'http', reason: 'Email delivery is not configured.' };
  }
  try {
    const res = await fetch(`${url.replace(/\/$/, '')}/emails`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: `"${env.EMAIL_FROM_NAME ?? 'Zenith'}" <${env.EMAIL_FROM ?? 'no-reply@zenith.local'}>`,
        to: [message.to],
        subject: message.subject,
        text: message.text,
        html: message.html,
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      return { ok: false, transport: 'http', reason: `Email provider rejected the request (HTTP ${res.status}).` };
    }
    return { ok: true, transport: 'http' };
  } catch {
    return { ok: false, transport: 'http', reason: 'The email provider could not be reached right now.' };
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function sendEmail(message: EmailMessage): Promise<EmailResult> {
  const transport = import.meta.env.EMAIL_TRANSPORT ?? 'console';

  if (transport === 'smtp') return smtpSend(message);
  if (transport === 'http') return httpSend(message);
  if (transport === 'console') return consoleSend(message);

  // No transport configured in production: fail loudly and honestly.
  console.error('[email] EMAIL_TRANSPORT is not set — email was NOT sent.');
  return { ok: false, transport: 'unconfigured', reason: 'Email delivery is not configured on the server.' };
}

/** Base URL used in links inside emails. */
export function emailBaseUrl(ctx: APIContext): string {
  return import.meta.env.PUBLIC_SITE_URL ?? ctx.url.origin;
}
