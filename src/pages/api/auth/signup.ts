import type { APIRoute } from 'astro';
import { ApiError, fail, readPayload, redirectTo, requireSameOrigin, requireStore } from '../../../lib/server/api';
import { cookieAttributes, createSession, hashPassword } from '../../../lib/server/auth';
import { clientKey, isRateLimited, recordHit } from '../../../lib/server/rateLimit';
import { logActivity } from '../../../lib/server/activity';
import { emailBaseUrl, sendEmail, verificationEmail } from '../../../lib/server/email';
import { issueToken } from '../../../lib/server/tokens';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const VERIFY_TTL_MS = 24 * 60 * 60 * 1000;

export const POST: APIRoute = async (ctx) => {
  try {
    requireSameOrigin(ctx);
    const store = await requireStore();
    const key = `signup:${clientKey(ctx.request)}`;
    if (isRateLimited(key)) throw new ApiError(429, 'rate_limited', 'Too many attempts. Please wait a few minutes.');
    // Record every attempt (successful or not) so the account-creation limit
    // actually engages instead of only counting "email already taken" replies.
    recordHit(key);

    const { email, password, confirmPassword, displayName } = await readPayload(ctx);
    const normalized = String(email ?? '').trim().toLowerCase();
    const pass = String(password ?? '');
    const confirm = String(confirmPassword ?? '');
    const name = String(displayName ?? '').trim().slice(0, 40);

    if (!EMAIL_RE.test(normalized)) throw new ApiError(400, 'invalid_email', 'Enter a valid email address.');
    if (pass.length < 8) throw new ApiError(400, 'weak_password', 'Password must be at least 8 characters.');
    if (pass !== confirm) throw new ApiError(400, 'password_mismatch', 'Passwords do not match.');
    if (!name) throw new ApiError(400, 'invalid_name', 'Enter a display name.');
    if (store.db().users.some((u) => u.email === normalized)) {
      throw new ApiError(409, 'email_taken', 'An account with that email already exists.');
    }

    const { hash, salt, iterations } = await hashPassword(pass);
    const now = new Date().toISOString();
    const userId = `user-${crypto.randomUUID()}`;

    await store.mutate((db) => {
      db.users.push({
        id: userId,
        email: normalized,
        displayName: name,
        passwordHash: hash,
        passwordScheme: 'pbkdf2-sha256',
        salt,
        iterations,
        role: 'user',
        emailVerified: false,
        suspended: false,
        createdAt: now,
        updatedAt: now,
      });
    });

    const token = await issueToken(store, 'verify-email', userId, VERIFY_TTL_MS);
    const base = emailBaseUrl(ctx);
    const verifyUrl = `${base}/auth/verify-email?token=${token}`;
    const result = await sendEmail(verificationEmail({ to: normalized, url: verifyUrl, base }));

    // Create the session so the new user is signed in while they verify.
    const sessionToken = await createSession(store, userId, ctx.request);
    await logActivity(store, userId, 'signup', 'Created an account.', ctx.request);

    if (!result.ok) {
      console.error('[auth] verification email could not be sent:', result.reason);
      return redirectTo(ctx, `/auth/check-email?email=${encodeURIComponent(normalized)}&email_failed=1`, {
        'Set-Cookie': cookieAttributes(ctx.request, sessionToken),
      });
    }
    return redirectTo(ctx, `/auth/check-email?email=${encodeURIComponent(normalized)}`, {
      'Set-Cookie': cookieAttributes(ctx.request, sessionToken),
    });
  } catch (error) {
    if (error instanceof ApiError) {
      return redirectTo(ctx, `/auth/signup?error=${encodeURIComponent(error.code)}`);
    }
    return fail(error);
  }
};
