import type { APIRoute } from 'astro';
import { readCookie, verifySessionToken } from '../../../../lib/server/auth';
import { fail, redirectTo, requireSameOrigin, requireUser } from '../../../../lib/server/api';
import { logActivity } from '../../../../lib/server/activity';

export const POST: APIRoute = async (ctx) => {
  try {
    requireSameOrigin(ctx);
    const { user, store } = await requireUser(ctx);

    // Keep the current session, remove every other one.
    const current = readCookie(ctx.request, 'zenith_session');
    const currentId = current ? await verifySessionToken(current) : null;
    await store.mutate((db) => {
      db.sessions = db.sessions.filter((s) => s.userId !== user.id || s.id === currentId);
    });
    await logActivity(store, user.id, 'settings_change', 'Signed out all other sessions.', ctx.request);

    return redirectTo(ctx, '/account/settings?signedout=1');
  } catch (error) {
    return fail(error);
  }
};
