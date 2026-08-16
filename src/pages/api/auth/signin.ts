import type { APIRoute } from 'astro';
import { ApiError, fail, readPayload, redirectTo, requireSameOrigin, requireStore } from '../../../lib/server/api';
import { cookieAttributes, createSession, verifyPassword } from '../../../lib/server/auth';
import { clientKey, isRateLimited, recordHit } from '../../../lib/server/rateLimit';
import { logActivity } from '../../../lib/server/activity';

export const POST: APIRoute = async (ctx) => {
  try {
    requireSameOrigin(ctx);
    const store = await requireStore();
    const key = `signin:${clientKey(ctx.request)}`;
    if (isRateLimited(key)) {
      throw new ApiError(429, 'rate_limited', 'Too many attempts. Please wait a few minutes and try again.');
    }

    const { email, password, next } = await readPayload(ctx);
    const normalized = String(email ?? '').trim().toLowerCase();
    if (!normalized || !password) throw new ApiError(400, 'invalid_credentials', 'Enter your email and password.');

    const user = store.db().users.find((u) => u.email === normalized);
    const passwordOk = user ? await verifyPassword(String(password), user) : false;
    if (!user || !passwordOk) {
      recordHit(key);
      throw new ApiError(401, 'invalid_credentials', 'Incorrect email or password.');
    }
    if (user.suspended) throw new ApiError(403, 'suspended', 'This account has been suspended.');

    const token = await createSession(store, user.id, ctx.request);
    await store.mutate((db) => {
      const u = db.users.find((x) => x.id === user.id);
      if (u) u.lastLoginAt = new Date().toISOString();
    });
    await logActivity(store, user.id, 'signin', 'Signed in from a new session.', ctx.request);

    const safeNext = typeof next === 'string' && next.startsWith('/') && !next.startsWith('//') ? next : '/account';
    const destination = user.emailVerified ? safeNext : `/account?unverified=1&next=${encodeURIComponent(safeNext)}`;
    return redirectTo(ctx, destination, { 'Set-Cookie': cookieAttributes(ctx.request, token) });
  } catch (error) {
    if (error instanceof ApiError) {
      return redirectTo(ctx, `/auth/signin?error=${encodeURIComponent(error.code)}`);
    }
    return fail(error);
  }
};
