import type { APIRoute } from 'astro';
import { ApiError, fail, readPayload, redirectTo, requireSameOrigin } from '../../../lib/server/api';
import { clientKey, isRateLimited } from '../../../lib/server/rateLimit';

/**
 * Support ticket intake.
 * Foundation build: validates and logs the message (dev console). The ticket
 * backend (database + support provider) plugs in here later.
 */
export const POST: APIRoute = async (ctx) => {
  try {
    requireSameOrigin(ctx);
    if (isRateLimited(`support:${clientKey(ctx.request)}`)) {
      throw new ApiError(429, 'rate_limited', 'Too many messages. Please wait a few minutes.');
    }

    const { email, topic, message } = await readPayload(ctx);
    const emailStr = String(email ?? '').trim();
    const msg = String(message ?? '').trim();
    if (!emailStr || !msg || msg.length > 4000) {
      throw new ApiError(400, 'invalid_input', 'Please provide a valid email and message.');
    }

    // eslint-disable-next-line no-console
    console.log(
      `\n[support-ticket] From: ${emailStr}\n[support-ticket] Topic: ${topic}\n[support-ticket] Message:\n${msg}\n`,
    );

    return redirectTo(ctx, '/support?sent=1#contact');
  } catch (error) {
    if (error instanceof ApiError) {
      return redirectTo(ctx, `/support?error=${encodeURIComponent(error.code)}#contact`);
    }
    return fail(error);
  }
};
