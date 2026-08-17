/**
 * Global middleware: applies security headers to every response (HTML pages
 * and API), keeps authenticated area indexes out of search engines, and
 * captures the Cloudflare runtime bindings so the D1-backed store can stay
 * fresh on every request.
 */
import { defineMiddleware } from 'astro:middleware';
import { setRuntimeEnv } from './lib/server/runtime';
import { refreshStore } from './lib/server/store';

const SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'",
  // Browsers ignore HSTS over plain HTTP, so local dev is unaffected; over
  // HTTPS (Cloudflare Pages) it forces secure connections.
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
};

export const onRequest = defineMiddleware(async (context, next) => {
  // The Cloudflare adapter exposes bindings (D1/R2) on every request; make
  // them available to domain code that has no Astro context.
  const env = (context.locals as { runtime?: { env?: unknown } }).runtime?.env;
  if (env) setRuntimeEnv(env);
  // Keep the per-isolate database snapshot fresh before this request runs
  // (no-op for the dev JSON store and unconfigured production).
  await refreshStore();

  const response = await next();
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    if (!headers.has(key)) headers.set(key, value);
  }
  const contentType = response.headers.get('content-type') ?? '';
  const isHtml = contentType.includes('text/html');
  if (isHtml && !headers.has('X-Robots-Tag')) {
    if (context.url.pathname.startsWith('/account') || context.url.pathname.startsWith('/hq') || context.url.pathname.startsWith('/api')) {
      headers.set('X-Robots-Tag', 'noindex, nofollow');
    }
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
});
