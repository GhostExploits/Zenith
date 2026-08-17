import type { APIRoute } from 'astro';
import { fail, json } from '../../lib/server/api';
import { checkLicense, licenseCheckResponse } from '../../lib/server/licenses';
import { getStore } from '../../lib/server/store';
import { clientKey, isRateLimited, recordHit } from '../../lib/server/rateLimit';

/**
 * License authority endpoints — the contract the Zenith client speaks.
 *
 *   POST /license/status    — the client's check. Validates status/expiry and
 *                             that the license is bound to the calling device,
 *                             then returns the signed entitlement payload the
 *                             client verifies locally. Never mutates binding.
 *   POST /license/activate  — validate + bind the device on first use (same as
 *                             the loader login, minus the session token).
 *
 * The client sends {licenseKey, deviceId, clientVersion}; the response shape
 * matches VapeService LicenseHttpHandler.activationJson exactly. Rejections
 * are HTTP 200 with successful:false so the loader/client can read the body.
 *
 * The license key is the credential — no user session is involved. Requests
 * are IP-rate-limited.
 */
export const POST: APIRoute = async (ctx) => {
  const action = ctx.params.action ?? '';
  if (action !== 'status' && action !== 'activate') {
    return json({ successful: false, code: 'LICENSE_INVALID', error: 'Unknown license endpoint' }, 200);
  }
  try {
    const ipKey = `license:${clientKey(ctx.request)}`;
    if (isRateLimited(ipKey)) {
      recordHit(ipKey);
      return json(licenseCheckResponse({ ok: false, code: 'LICENSE_RATE_LIMITED', message: 'Too many attempts. Please wait a few minutes.' }));
    }
    const store = await getStore();
    let body: { licenseKey?: unknown; deviceId?: unknown; clientVersion?: unknown };
    try {
      body = (await ctx.request.json()) as { licenseKey?: unknown; deviceId?: unknown; clientVersion?: unknown };
    } catch {
      return json({ successful: false, code: 'LICENSE_INVALID', error: 'Expected a JSON body' }, 200);
    }
    recordHit(ipKey);

    const licenseKey = String(body.licenseKey ?? '').trim();
    const deviceId = String(body.deviceId ?? '').trim();
    const clientVersion = String(body.clientVersion ?? '').trim() || undefined;
    const result = await checkLicense(store, licenseKey, deviceId, {
      bind: action === 'activate',
      clientVersion,
      ip: clientKey(ctx.request),
    });
    return json(licenseCheckResponse(result, false), 200);
  } catch (error) {
    return fail(error);
  }
};
