import type { APIRoute } from 'astro';
import { ApiError, fail, ok } from '../../../lib/server/api';
import { handleWebhookEvent, paymentsEnabled, verifyWebhookSignature } from '../../../lib/server/payments';
import { getStore } from '../../../lib/server/store';

const MAX_BODY_BYTES = 2_000_000;

/**
 * Paddle webhook endpoint.
 *
 * Authentication is the signature itself: the raw body is HMAC-SHA256 verified
 * against `Paddle-Signature` using PADDLE_WEBHOOK_SECRET. No user session is
 * involved. Entitlements and licenses are granted here — the only place a
 * payment is trusted.
 */
export const POST: APIRoute = async (ctx) => {
  try {
    // Maintenance mode: while payments are disabled (the default), webhooks
    // are deliberately ignored — no entitlement can be granted from a
    // payment event. Once PAYMENTS_ENABLED=true is set, the signature check
    // below is the only thing that lets an event through.
    if (!paymentsEnabled()) {
      throw new ApiError(
        503,
        'payments_maintenance',
        'Payments are temporarily unavailable while the payment system is being finalized.',
      );
    }
    const raw = await ctx.request.text();
    if (raw.length > MAX_BODY_BYTES) {
      throw new ApiError(413, 'payload_too_large', 'Webhook payload too large.');
    }
    const valid = await verifyWebhookSignature(ctx.request, raw);
    if (!valid) {
      throw new ApiError(401, 'invalid_signature', 'Webhook signature verification failed.');
    }

    let event: Record<string, any>;
    try {
      event = JSON.parse(raw);
    } catch {
      throw new ApiError(400, 'invalid_json', 'Webhook body is not valid JSON.');
    }

    const store = await getStore();
    await handleWebhookEvent(store, event as Parameters<typeof handleWebhookEvent>[1]);

    return ok({ received: true });
  } catch (error) {
    return fail(error);
  }
};
