import type { APIRoute } from 'astro';
import { ApiError, fail, readPayload, redirectTo, requireSameOrigin, requireStore } from '../../../lib/server/api';
import { hashPassword } from '../../../lib/server/auth';
import { clientKey, isRateLimited, recordHit } from '../../../lib/server/rateLimit';
import { logActivity } from '../../../lib/server/activity';
import { consumeToken } from '../../../lib/server/tokens';

export const POST: APIRoute = async (ctx) => {
  let token = '';
  try {
    requireSameOrigin(ctx);
    const store = await requireStore();
    const key = `reset:${clientKey(ctx.request)}`;
    if (isRateLimited(key)) {
      throw new ApiError(429, 'rate_limited', 'Too many attempts. Please wait a few minutes.');
    }
    recordHit(key);

    const payload = await readPayload(ctx);
    token = String(payload.token ?? '');
    const pass = String(payload.password ?? '');
    const confirm = String(payload.confirmPassword ?? '');
    if (pass.length < 8) throw new ApiError(400, 'weak_password', 'Password must be at least 8 characters.');
    if (pass !== confirm) throw new ApiError(400, 'password_mismatch', 'Passwords do not match.');

    const result = await consumeToken(store, 'reset-password', token);
    if (result.status !== 'ok' || !result.userId) {
      throw new ApiError(400, 'invalid_token', 'This reset link is invalid or has expired.');
    }

    const now = new Date().toISOString();
    const { hash, salt, iterations } = await hashPassword(pass);
    await store.mutate((db) => {
      const user = db.users.find((u) => u.id === result.userId);
      if (user) {
        user.passwordHash = hash;
        user.salt = salt;
        user.iterations = iterations;
        user.updatedAt = now;
      }
      // Invalidate all existing sessions for the account (password changed).
      db.sessions = db.sessions.filter((s) => s.userId !== result.userId);
    });
    await logActivity(store, result.userId, 'password_change', 'Password was reset.', ctx.request);

    return redirectTo(ctx, '/auth/signin?reset=1');
  } catch (error) {
    if (error instanceof ApiError) {
      return redirectTo(ctx, `/auth/reset-password?token=${encodeURIComponent(token)}&error=${encodeURIComponent(error.code)}`);
    }
    return fail(error);
  }
};
