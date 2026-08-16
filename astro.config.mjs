// @ts-check
import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import sitemap from '@astrojs/sitemap';

// https://astro.build/config
export default defineConfig({
  // Placeholder until the production domain is decided (zenith.vip or similar).
  site: 'https://zenith.pages.dev',

  // Hybrid output: public marketing pages are prerendered to static files,
  // while API routes, account pages, and the admin panel run on-demand
  // through Cloudflare Pages Functions.
  output: 'server',

  adapter: cloudflare({
    platformProxy: { enabled: true },
  }),

  integrations: [sitemap()],

  vite: {
    build: {
      // Keep the worker bundle small and legible for review.
      minify: 'esbuild',
    },
  },

  // Astro's built-in origin check defaults to ON in recent versions, but it
  // rejects POSTs without an Origin header — which would break launcher/CLI
  // clients (and curl). It is therefore disabled explicitly. CSRF is enforced
  // consistently by our own `requireSameOrigin` helper in
  // src/lib/server/api.ts (SameSite=Lax cookies + Origin / Sec-Fetch-Site
  // checks, with header-less native clients allowed).
  security: {
    checkOrigin: false,
  },
});
