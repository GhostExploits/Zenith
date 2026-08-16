import type { APIRoute } from 'astro';
import { fail, redirectTo, requireSameOrigin, requireStore } from '../../../lib/server/api';
import { deleteCookie, destroySession, getSessionUser } from '../../../lib/server/auth';
import { logActivity } from '../../../lib/server/activity';

export const POST: APIRoute = async (ctx) => {
  try {
    requireSameOrigin(ctx);
    const store = await requireStore();
    const user = await getSessionUser(store, ctx.request);
    if (user) await logActivity(store, user.id, 'signout', 'Signed out.', ctx.request);
    await destroySession(store, ctx.request);
    return redirectTo(ctx, '/', { 'Set-Cookie': deleteCookie(ctx.request) });
  } catch (error) {
    return fail(error);
  }
};
