import type { APIRoute } from 'astro';
import { ApiError, fail, readPayload, redirectTo, requireSameOrigin, requireStore } from '../../../lib/server/api';
import { clientKey, isRateLimited } from '../../../lib/server/rateLimit';
import { emailBaseUrl, passwordResetEmail, sendEmail } from '../../../lib/server/email';
import { issueToken } from '../../../lib/server/tokens';

const RESET_TTL_MS = 60 * 60 * 1000;

/**
 * Password reset request.
 *
 * The response is identical whether or not the email has an account, so an
 * attacker cannot enumerate accounts through this endpoint. When a delivery
 * fails it is logged server-side (the caller never learns whether the email
 * existed — that information is not actionable for them anyway).
 */
export const POST: APIRoute = async (ctx) => {
  try {
    requireSameOrigin(ctx);
    const store = await requireStore();
    if (isRateLimited(`forgot:${clientKey(ctx.request)}`)) {
      throw new ApiError(429, 'rate_limited', 'Too many attempts. Please wait a few minutes.');
    }

    const { email } = await readPayload(ctx);
    const normalized = String(email ?? '').trim().toLowerCase();

    const user = store.db().users.find((u) => u.email === normalized);
    if (user) {
      const token = await issueToken(store, 'reset-password', user.id, RESET_TTL_MS);
      const base = emailBaseUrl(ctx);
      const resetUrl = `${base}/auth/reset-password?token=${token}`;
      const result = await sendEmail(passwordResetEmail({ to: normalized, url: resetUrl, base }));
      if (!result.ok) {
        // Do not reveal account existence through the response; log instead.
        console.error(`[auth] reset email could not be sent to ${normalized}:`, result.reason);
      }
    }

    return redirectTo(ctx, '/auth/forgot-password?sent=1');
  } catch (error) {
    if (error instanceof ApiError) {
      return redirectTo(ctx, `/auth/forgot-password?error=${encodeURIComponent(error.code)}`);
    }
    return fail(error);
  }
};
