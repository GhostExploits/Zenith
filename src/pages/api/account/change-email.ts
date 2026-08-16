import type { APIRoute } from 'astro';
import { ApiError, fail, readPayload, redirectTo, requireSameOrigin, requireUser } from '../../../lib/server/api';
import { emailBaseUrl, sendEmail, verificationEmail } from '../../../lib/server/email';
import { issueToken } from '../../../lib/server/tokens';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const VERIFY_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Change email.
 *
 * The address is NOT changed immediately. A verification token for the new
 * address is issued and emailed; only when the user clicks the link is
 * `pendingEmail` adopted (see /auth/verify-email). The old address keeps
 * working until then.
 */
export const POST: APIRoute = async (ctx) => {
  try {
    requireSameOrigin(ctx);
    const { user, store } = await requireUser(ctx);

    const { email } = await readPayload(ctx);
    const normalized = String(email ?? '').trim().toLowerCase();

    if (!EMAIL_RE.test(normalized)) throw new ApiError(400, 'invalid_email', 'Enter a valid email address.');
    if (normalized === user.email) throw new ApiError(400, 'same_email', 'That is already your current email address.');
    if (store.db().users.some((u) => u.email === normalized)) {
      throw new ApiError(409, 'email_taken', 'An account with that email already exists.');
    }

    const token = await issueToken(store, 'verify-email', user.id, VERIFY_TTL_MS, normalized);
    await store.mutate((db) => {
      const u = db.users.find((x) => x.id === user.id);
      if (u) u.pendingEmail = normalized;
    });

    const base = emailBaseUrl(ctx);
    const verifyUrl = `${base}/auth/verify-email?token=${token}`;
    const result = await sendEmail(verificationEmail({ to: normalized, url: verifyUrl, base }));

    if (!result.ok) {
      // Don't leave the account in a pending state if we couldn't deliver.
      await store.mutate((db) => {
        const u = db.users.find((x) => x.id === user.id);
        if (u) u.pendingEmail = undefined;
        db.tokens = db.tokens.filter((t) => t.token !== token);
      });
      console.error('[auth] change-email verification email could not be sent:', result.reason);
      throw new ApiError(503, 'email_failed', 'We could not send the verification email right now. Please try again later.');
    }

    return redirectTo(ctx, '/account/settings?email_sent=1');
  } catch (error) {
    if (error instanceof ApiError) {
      return redirectTo(ctx, `/account/settings?error=${encodeURIComponent(error.code)}`);
    }
    return fail(error);
  }
};
