import type { APIRoute } from 'astro';
import { fail, json } from '../../lib/server/api';
import { checkLicense, licenseCheckResponse } from '../../lib/server/licenses';
import { getStore } from '../../lib/server/store';
import { clientKey, isRateLimited, recordHit } from '../../lib/server/rateLimit';

/**
 * Loader login (`POST /loader/login`) — the Zenith loader's entry point.
 *
 * The loader sends {licenseKey, deviceId} and expects {successful, token} on
 * success. This endpoint validates the license, BINDS it to the device on
 * first use (max 1 device), and mints an opaque session token exactly like
 * the local VapeService did.
 *
 * The license key is the credential here — there is no user session. Requests
 * are IP-rate-limited, and every response is HTTP 200 with successful:false on
 * rejection because the loader only reads the body on HTTP 200.
 */
export const POST: APIRoute = async (ctx) => {
  try {
    const key = `license:${clientKey(ctx.request)}`;
    if (isRateLimited(key)) {
      recordHit(key);
      return json(licenseCheckResponse({ ok: false, code: 'LICENSE_RATE_LIMITED', message: 'Too many attempts. Please wait a few minutes.' }));
    }
    const store = await getStore();
    let body: { licenseKey?: unknown; deviceId?: unknown };
    try {
      body = (await ctx.request.json()) as { licenseKey?: unknown; deviceId?: unknown };
    } catch {
      return json({ successful: false, code: 'LICENSE_INVALID', error: 'Expected a JSON body' }, 200);
    }
    recordHit(key);

    const licenseKey = String(body.licenseKey ?? '').trim();
    const deviceId = String(body.deviceId ?? '').trim();
    const result = await checkLicense(store, licenseKey, deviceId, {
      bind: true,
      ip: clientKey(ctx.request),
    });
    return json(licenseCheckResponse(result, true), 200);
  } catch (error) {
    return fail(error);
  }
};
