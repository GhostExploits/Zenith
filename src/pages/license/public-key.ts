import type { APIRoute } from 'astro';
import { publicKeyPem } from '../../lib/server/authority';

/**
 * GET /license/public-key — the Zenith client's trust anchor, served as PEM.
 * Part of the VapeService contract; useful for tooling that wants to confirm
 * the configured signing key matches the key embedded in the client.
 */
export const GET: APIRoute = async () => {
  const pem = await publicKeyPem();
  return new Response(pem, {
    status: 200,
    headers: {
      'Content-Type': 'application/x-pem-file; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
};
