import type { APIRoute } from 'astro';
import { ApiError, fail, redirectTo, requireSameOrigin, requireUser } from '../../../../lib/server/api';
import { logActivity } from '../../../../lib/server/activity';
import { cancelSubscription, paymentsEnabled, reinstateSubscription } from '../../../../lib/server/payments';

/**
 * Cancel / reinstate a subscription.
 *
 * The provider is the source of truth: with payments configured, cancellation
 * is scheduled at the provider first and only reflected locally after the
 * provider confirms; without a provider (dev), the local flag is flipped so
 * the flow stays testable.
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
      // While payments are in maintenance mode, never call the provider — the
      // local flag is still flipped so the dev flow stays testable.
      if (sub.provider === 'paddle' && sub.providerRef && !paymentsEnabled()) {
        throw new ApiError(
          503,
          'payments_maintenance',
          'Payments are temporarily unavailable while the payment system is being finalized.',
        );
      }
      if (sub.provider === 'paddle' && sub.providerRef) {
        try {
          await cancelSubscription(sub.providerRef);
        } catch {
          throw new ApiError(502, 'provider_error', 'The payment provider could not process the cancellation right now.');
        }
      }
      await store.mutate((db) => {
        const s = db.subscriptions.find((x) => x.id === id);
        if (s) s.cancelAtPeriodEnd = true;
      });
      await logActivity(store, user.id, 'subscription_change', 'Subscription cancellation scheduled.', ctx.request);
      return redirectTo(ctx, '/account/subscriptions?cancelled=1');
    }

    if (action === 'reinstate') {
      if (sub.provider === 'paddle' && sub.providerRef && !paymentsEnabled()) {
        throw new ApiError(
          503,
          'payments_maintenance',
          'Payments are temporarily unavailable while the payment system is being finalized.',
        );
      }
      if (sub.provider === 'paddle' && sub.providerRef) {
        try {
          await reinstateSubscription(sub.providerRef);
        } catch {
          throw new ApiError(502, 'provider_error', 'The payment provider could not revoke the cancellation right now.');
        }
      }
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
