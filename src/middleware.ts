/**
 * Global middleware: applies security headers to every response (HTML pages
 * and API), and keeps authenticated area indexes out of search engines.
 */
import { defineMiddleware } from 'astro:middleware';

const SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'",
};

export const onRequest = defineMiddleware(async (context, next) => {
  const response = await next();
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    if (!headers.has(key)) headers.set(key, value);
  }
  const contentType = response.headers.get('content-type') ?? '';
  const isHtml = contentType.includes('text/html');
  if (isHtml && !headers.has('X-Robots-Tag')) {
    if (context.url.pathname.startsWith('/account') || context.url.pathname.startsWith('/admin') || context.url.pathname.startsWith('/api')) {
      headers.set('X-Robots-Tag', 'noindex, nofollow');
    }
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
});
