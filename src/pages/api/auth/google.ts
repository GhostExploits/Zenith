import type { APIRoute } from 'astro';
import { fail, redirectTo } from '../../../lib/server/api';
import { buildGoogleAuthUrl, googleConfig } from '../../../lib/server/google';

/**
 * Start "Continue with Google".
 * Redirects to Google's consent screen with PKCE + state + nonce; the state
 * is carried in a short-lived HttpOnly cookie so the callback can prove this
 * authorization request actually originated from this browser.
 */
export const GET: APIRoute = async (ctx) => {
  try {
    if (!googleConfig()) {
      return redirectTo(ctx, '/auth/signin?error=oauth_not_configured');
    }
    const { url, cookie } = buildGoogleAuthUrl(ctx.request);
    return redirectTo(ctx, url.toString(), { 'Set-Cookie': cookie });
  } catch (error) {
    return fail(error);
  }
};
