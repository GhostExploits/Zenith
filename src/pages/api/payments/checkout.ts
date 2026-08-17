import type { APIRoute } from 'astro';
import { ApiError, fail, readPayload, redirectTo, requireSameOrigin, requireUser } from '../../../lib/server/api';
import { getPlan, getProductById } from '../../../lib/server/catalog';
import { hasEntitlement } from '../../../lib/server/entitlements';
import { createCheckout, requirePaymentsEnabled } from '../../../lib/server/payments';
import { notify } from '../../../lib/server/notifications';
import { clientKey, isRateLimited, recordHit } from '../../../lib/server/rateLimit';

/**
 * Start checkout for a plan.
 *
 * Requires a signed-in session and a same-origin request (CSRF). The server
 * creates the checkout with the payment provider (price taken from the
 * database plan — admin price edits apply immediately) and redirects to the
 * provider's hosted checkout. Nothing is granted from this request; the
 * license is created only by the verified webhook.
 */
export const POST: APIRoute = async (ctx) => {
  try {
    requireSameOrigin(ctx);
    if (isRateLimited(`checkout:${clientKey(ctx.request)}`)) {
      recordHit(`checkout:${clientKey(ctx.request)}`);
      throw new ApiError(429, 'rate_limited', 'Too many checkout requests. Please wait a few minutes.');
    }
    recordHit(`checkout:${clientKey(ctx.request)}`);
    const { user, store } = await requireUser(ctx);
    const payload = await readPayload(ctx);
    const planId = String(payload.planId ?? '').trim();

    const plan = await getPlan(planId);
    if (!plan || !plan.active) throw new ApiError(404, 'plan_not_found', 'That plan is not available.');
    const product = await getProductById(plan.productId);
    if (!product || product.availability === 'unavailable') {
      throw new ApiError(404, 'product_not_found', 'That product is not available.');
    }
    if (hasEntitlement(store.db(), user, plan.productId)) {
      throw new ApiError(409, 'already_entitled', 'You already hold an entitlement for this product.');
    }
    // Maintenance mode: payments are disabled by default and must be
    // deliberately enabled with PAYMENTS_ENABLED=true. This guard fires first
    // so no provider request is ever created from here.
    requirePaymentsEnabled();

    // Replace any stale pending checkout for the same user+plan so the admin
    // orders list stays clean.
    await store.mutate((db) => {
      db.purchases = db.purchases.map((p) =>
        p.userId === user.id && p.planId === plan.id && p.status === 'pending'
          ? { ...p, status: 'failed' }
          : p,
      );
    });

    const base = import.meta.env.PUBLIC_SITE_URL ?? ctx.url.origin;
    const { url, transactionId } = await createCheckout({
      store,
      user,
      plan,
      product,
      successUrl: `${base}/checkout/success?plan=${plan.id}`,
      cancelUrl: `${base}/checkout/cancel?plan=${plan.id}`,
    });

    await store.mutate((db) => {
      db.purchases.push({
        id: `purchase-${crypto.randomUUID()}`,
        userId: user.id,
        productId: plan.productId,
        planId: plan.id,
        amountCents: plan.priceCents ?? 0,
        currency: plan.currency,
        status: 'pending',
        provider: 'paddle',
        providerRef: transactionId,
        createdAt: new Date().toISOString(),
      });
    });
    await notify(store, 'purchase', 'Checkout started', `${user.email} started checkout for ${plan.name}.`);

    return redirectTo(ctx, url);
  } catch (error) {
    return fail(error);
  }
};
