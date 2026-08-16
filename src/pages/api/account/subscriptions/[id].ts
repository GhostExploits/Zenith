import type { APIRoute } from 'astro';
import { ApiError, fail, redirectTo, requireSameOrigin, requireUser } from '../../../../lib/server/api';
import { logActivity } from '../../../../lib/server/activity';

/**
 * Cancel / reinstate a subscription.
 *
 * This is the server-side contract for the (future) payment provider: a real
 * integration will call the provider's API to schedule cancellation and only
 * reflect provider-confirmed state. The dev store just flips the flag.
 */
export const POST: APIRoute = async (ctx) => {
  try {
    requireSameOrigin(ctx);
    const { user, store } = await requireUser(ctx);
    const id = ctx.params.id ?? '';
    const action = (await ctx.request.formData().catch(() => new FormData())).get('action') ?? '';

    const sub = store.db().subscriptions.find((s) => s.id === id && s.userId === user.id);
    if (!sub) throw new ApiError(404, 'not_found', 'Subscription not found.');

    if (action === 'cancel') {
      if (sub.status !== 'active') throw new ApiError(400, 'not_active', 'Subscription is not active.');
      await store.mutate((db) => {
        const s = db.subscriptions.find((x) => x.id === id);
        if (s) s.cancelAtPeriodEnd = true;
      });
      await logActivity(store, user.id, 'subscription_change', 'Subscription cancellation scheduled.', ctx.request);
      return redirectTo(ctx, '/account/subscriptions?cancelled=1');
    }

    if (action === 'reinstate') {
      await store.mutate((db) => {
        const s = db.subscriptions.find((x) => x.id === id);
        if (s) s.cancelAtPeriodEnd = false;
      });
      await logActivity(store, user.id, 'subscription_change', 'Subscription cancellation cancelled.', ctx.request);
      return redirectTo(ctx, '/account/subscriptions?reinstate=1');
    }

    throw new ApiError(400, 'bad_action', 'Unknown action.');
  } catch (error) {
    if (error instanceof ApiError) {
      return redirectTo(ctx, `/account/subscriptions?error=${encodeURIComponent(error.code)}`);
    }
    return fail(error);
  }
};
