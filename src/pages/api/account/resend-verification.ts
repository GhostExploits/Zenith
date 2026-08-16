import type { APIRoute } from 'astro';
import { ApiError, fail, redirectTo, requireSameOrigin, requireUser } from '../../../lib/server/api';
import { emailBaseUrl, sendEmail, verificationEmail } from '../../../lib/server/email';
import { issueToken } from '../../../lib/server/tokens';

const VERIFY_TTL_MS = 24 * 60 * 60 * 1000;

export const POST: APIRoute = async (ctx) => {
  try {
    requireSameOrigin(ctx);
    const { user, store } = await requireUser(ctx);
    if (user.emailVerified) return redirectTo(ctx, '/account/settings');

    // Rate limit per user AND per IP so resend can't be used to spam.
    const ipKey = ctx.request.headers.get('cf-connecting-ip') ?? 'unknown';
    if (resendLimited(user.id, ipKey)) {
      throw new ApiError(429, 'rate_limited', 'You have requested too many verification emails. Please wait a few minutes.');
    }

    // Issuing a new token invalidates any previous verification tokens
    // (safer: only the newest link works).
    const token = await issueToken(store, 'verify-email', user.id, VERIFY_TTL_MS);
    const base = emailBaseUrl(ctx);
    const verifyUrl = `${base}/auth/verify-email?token=${token}`;
    const result = await sendEmail(verificationEmail({ to: user.email, url: verifyUrl, base }));

    if (!result.ok) {
      console.error('[auth] verification email could not be sent:', result.reason);
      return redirectTo(ctx, '/account/settings?error=email_failed');
    }
    return redirectTo(ctx, '/account/settings?sent=1');
  } catch (error) {
    if (error instanceof ApiError) {
      return redirectTo(ctx, `/account/settings?error=${encodeURIComponent(error.code)}`);
    }
    return fail(error);
  }
};

// Small in-memory resend limiter (dev-grade; replace with distributed limiting
// in production alongside the auth rate limiter).
const RESEND_WINDOW_MS = 5 * 60 * 1000;
const RESEND_MAX = 3;
const resendHits = new Map<string, number[]>();

function resendLimited(userId: string, ip: string): boolean {
  const now = Date.now();
  const key = `${userId}:${ip}`;
  const hits = (resendHits.get(key) ?? []).filter((t) => now - t < RESEND_WINDOW_MS);
  if (hits.length >= RESEND_MAX) {
    resendHits.set(key, hits);
    return true;
  }
  hits.push(now);
  resendHits.set(key, hits);
  return false;
}
