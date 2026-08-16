import type { APIRoute } from 'astro';
import { ApiError, fail, redirectTo, requireUser } from '../../../lib/server/api';
import { getStoredAsset } from '../../../lib/server/storage';
import { hasSubscribedAccess } from '../../../lib/server/entitlements';
import { logActivity } from '../../../lib/server/activity';
import { getProductById, getRelease } from '../../../lib/server/catalog';
import { StorageNotConfiguredError } from '../../../lib/server/store';
import { clientKey, isRateLimited } from '../../../lib/server/rateLimit';

/** Map API error codes to styled-denial reasons for browser visitors. */
const DENIED_REASONS: Record<string, string> = {
  unauthenticated: 'signin_required',
  email_unverified: 'email_unverified',
  no_subscription: 'no_subscription',
  not_found: 'not_found',
  not_published: 'not_found',
  asset_missing: 'not_found',
  storage_not_configured: 'not_configured',
};

/** Browser navigation vs. API client (launcher/curl). */
function isBrowser(request: Request): boolean {
  const accept = request.headers.get('accept') ?? '';
  const dest = request.headers.get('sec-fetch-dest') ?? '';
  return accept.includes('text/html') || dest === 'document';
}

/**
 * For browser visitors, turn a denial into a redirect to the styled
 * /denied page (with the reason + a next link back). Returns null when the
 * error has no browser-friendly mapping (API clients get JSON instead).
 */
function deniedRedirect(ctx: Parameters<APIRoute>[0], error: unknown): Response | null {
  let reason: string | null = null;
  if (error instanceof ApiError) {
    reason = DENIED_REASONS[error.code] ?? null;
  } else if (error instanceof StorageNotConfiguredError) {
    reason = 'not_configured';
  }
  if (!reason) return null;
  const url = new URL(ctx.request.url);
  const location = `/denied?reason=${reason}&next=${encodeURIComponent(url.pathname + url.search)}`;
  return redirectTo(ctx, location);
}

/**
 * Protected download endpoint.
 *
 * Access requires, in order:
 *   1. an authenticated session,
 *   2. a published, not-scheduled release,
 *   3. an ACTIVE SUBSCRIPTION for the release's product (subscribers only),
 *   4. a stored asset to deliver.
 *
 * Files are never served from public/ — they are streamed from private
 * storage after the checks above pass. Production storage should use
 * short-lived signed URLs or R2 with this endpoint issuing them.
 */
export const GET: APIRoute = async (ctx) => {
  try {
    if (isRateLimited(`download:${clientKey(ctx.request)}`)) {
      throw new ApiError(429, 'rate_limited', 'Too many download requests. Please wait a few minutes.');
    }
    const { user, store } = await requireUser(ctx);
    const releaseId = ctx.params.releaseId ?? '';

    const release = await getRelease(releaseId);
    if (!release) throw new ApiError(404, 'not_found', 'Release not found.');
    // Downloads require a verified email — the address is how ownership is
    // proven for paid entitlements, and unverified accounts cannot redeem them.
    if (!user.emailVerified) {
      throw new ApiError(403, 'email_unverified', 'Verify your email address before downloading releases.');
    }
    if (release.scheduledFor && new Date(release.scheduledFor).getTime() > Date.now()) {
      throw new ApiError(404, 'not_published', 'This release is not available yet.');
    }

    const product = await getProductById(release.productId);
    if (release.requiresEntitlement) {
      if (!product) throw new ApiError(404, 'not_found', 'Product not found.');
      if (!hasSubscribedAccess(store.db(), user, product.id)) {
        throw new ApiError(403, 'no_subscription', `Downloads require an active subscription to ${product.name}.`);
      }
    }

    const filename = release.asset?.filename ?? `${release.version}.jar`;
    const asset = await getStoredAsset(release.id, filename);
    if (!asset) {
      if (import.meta.env.DEV) {
        throw new ApiError(404, 'asset_missing', 'This release has no download asset attached yet (dev storage is empty).');
      }
      throw new ApiError(503, 'storage_not_configured', 'Protected downloads are not configured in this environment yet.');
    }

    await logActivity(store, user.id, 'download', `Downloaded ${product?.name ?? 'product'} ${release.version}.`, ctx.request);

    const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
    return new Response(asset.data, {
      status: 200,
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(asset.sizeBytes),
        'Content-Disposition': `attachment; filename="${safeName}"`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    if (isBrowser(ctx.request)) {
      const denied = deniedRedirect(ctx, error);
      if (denied) return denied;
    }
    return fail(error);
  }
};
