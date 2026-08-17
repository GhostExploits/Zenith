import type { APIRoute } from 'astro';
import { ApiError, fail, redirectTo, requireStore } from '../../../../lib/server/api';
import { cookieAttributes, createSession } from '../../../../lib/server/auth';
import { handleGoogleCallback, linkGoogleIdentity } from '../../../../lib/server/google';
import { logActivity } from '../../../../lib/server/activity';
import { clientKey, isRateLimited, recordHit } from '../../../../lib/server/rateLimit';

/**
 * Google OAuth callback.
 *
 * The state cookie + PKCE verifier + ID-token nonce are all validated in
 * `handleGoogleCallback` before anything else happens. The session is created
 * server-side here — the browser never decides success.
 */
export const GET: APIRoute = async (ctx) => {
  try {
    if (isRateLimited(`oauth:${clientKey(ctx.request)}`)) {
      recordHit(`oauth:${clientKey(ctx.request)}`);
      throw new ApiError(429, 'rate_limited', 'Too many attempts. Please wait a few minutes.');
    }
    recordHit(`oauth:${clientKey(ctx.request)}`);
    const result = await handleGoogleCallback(ctx.request);
    const setCookie = [result.clearCookie];

    if (!result.ok) {
      return redirectTo(ctx, `/auth/signin?error=${encodeURIComponent(result.code)}`, {
        'Set-Cookie': setCookie.join('; '),
      });
    }
    const next = result.next && result.next.startsWith('/') ? result.next : '/account';

    const store = await requireStore();
    const link = await linkGoogleIdentity(store, result.profile);
    if (link.status === 'email_conflict') {
      return redirectTo(ctx, `/auth/signin?error=oauth_email_conflict`, {
        'Set-Cookie': setCookie.join('; '),
      });
    }

    const user = link.user;
    const token = await createSession(store, user.id, ctx.request);
    setCookie.push(cookieAttributes(ctx.request, token));
    await store.mutate((db) => {
      const u = db.users.find((x) => x.id === user.id);
      if (u) u.lastLoginAt = new Date().toISOString();
    });
    await logActivity(
      store,
      user.id,
      'signin',
      link.linked ? 'Signed in with Google (account linked).' : 'Signed in with Google.',
      ctx.request,
    );

    return redirectTo(ctx, next, { 'Set-Cookie': setCookie.join('; ') });
  } catch (error) {
    return fail(error);
  }
};
