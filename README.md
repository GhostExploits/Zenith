# Zenith — Official Website

The official website for **Zenith**, a premium Minecraft client. This repository
contains the public site, the account portal, the commerce architecture, and a
secure admin foundation — built to deploy on Cloudflare Pages.

> **Status: Step One foundation, Cloudflare-ready.** Public site, real
> authentication (email/password + Google OAuth, email verification),
> entitlements, protected downloads, and the admin panel are implemented and
> verified against the production Cloudflare worker locally. A production
> database, payments, real release storage, and a live email provider are
> designed-for and documented below but intentionally not connected yet —
> those routes return a clean `503 backend_not_configured` until then.

> **Owner guides:** [`CUSTOMIZE.md`](CUSTOMIZE.md) — where to edit text,
> screenshots, colors, and how to use the admin panel. [`DEPLOY.md`](DEPLOY.md)
> — step-by-step Cloudflare Pages publishing (connect this GitHub repo; you do
> not upload a static folder).

---

## Quick start

```bash
npm install

# Development (creates a seeded local database on first run:
# data/db.json + data/storage with placeholder release files)
npm run dev
# → http://localhost:4321

# Typecheck
npm run typecheck

# Production build (Cloudflare Pages output)
npm run build
```

### Default development accounts

On first run, the dev database is seeded automatically. **Dev only — never
production:**

| Account | Email | Password |
| --- | --- | --- |
| Owner / admin | `admin@zenith.local` | `zenith-dev-admin` |
| Demo user (has an active subscription) | `alex@example.com` | `zenith-dev-password` |
| Demo user | `sam@example.com` | `zenith-dev-password` |

Override the admin credentials with `ADMIN_EMAIL` / `ADMIN_PASSWORD` in `.env`
(see [Environment variables](#environment-variables)). The seeded data lives in
`data/` which is gitignored — delete `data/` to re-seed a clean database.

---

## Stack

- **Astro 5** — static-first pages plus on-demand server routes (API, account,
  admin) through the **Cloudflare adapter** (`@astrojs/cloudflare`).
- **TypeScript** throughout, strict mode.
- **Plain CSS design system** (`src/styles/global.css`) — tokens, no framework.
  Two self-hosted variable fonts: Space Grotesk (display) + Inter (UI).
- **No client-side framework** — server-rendered forms with small vanilla-TS
  scripts (mobile nav, FAQ accordions, lightbox, confirm dialogs, password
  strength meters).
- **Auth** — email/password via PBKDF2 + Web Crypto; Google OAuth 2.0 / OIDC via
  **arctic** (PKCE + state + nonce); email through an SMTP or HTTP provider via
  **nodemailer** / `fetch` (console transport in dev).
- **Tests** — **vitest** unit tests for the security-critical logic (token
  single-use, OAuth account linking, ID-token validation).
- `sharp` is a dev-only build tool for the logo/favicon pipeline.

### Why Astro + Cloudflare Pages?

Marketing pages are prerendered to static files (fast, cacheable, good SEO),
while anything stateful — auth, account, admin, downloads, APIs — runs as
on-demand server routes. On Cloudflare Pages the whole thing deploys as a
single worker with zero servers to manage.

---

## Project structure

```
public/                  Static assets (logo, favicons, media placeholders, headers)
scripts/                 Dev tooling: logo pipeline, placeholder generator
src/
  config/site.ts         Central site config (name, links, nav, CTA, placeholders)
  content/               Editable catalog: products, plans, features, changelog,
                         faq, media, announcements, legal (data-driven marketing)
  styles/global.css      Design system: tokens, components, responsive, a11y
  components/            Header, Footer, Logo, icons, layouts
  layouts/               BaseLayout (SEO/head), MarketingLayout, AppLayout, AdminLayout
  lib/
    types.ts             Domain model (products, plans, releases, users, commerce)
    format.ts            Price/date/size formatting
    server/
      store.ts           DB abstraction: JSON-file store (dev) + prod placeholder
      auth.ts            PBKDF2 hashing, signed session cookies, CSRF, roles
      tokens.ts          Single-use expiring tokens (verify email, reset password)
      google.ts          Google OAuth: PKCE/state/nonce, ID-token validation,
                         account linking
      email.ts           Email transports (console/smtp/http) + branded templates
      entitlements.ts    Server-side entitlement computation
      catalog.ts         DB-first catalog with static fallback
      storage.ts         Private release-asset storage abstraction
      api.ts, guard.ts   API helpers + SSR page guards
      seed.ts            Dev seed (admin account, demo data, placeholder assets)
  pages/
    index.astro          Home (prerendered)
    products, features, changelog, faq, support, community, media, legal, 404
    auth/                signin, signup, check-email, forgot/reset password,
                         verify email (incl. change-email confirmation)
    account/             overview, products, subscriptions, downloads, settings
    admin/               dashboard, users, products, plans, releases, faqs,
                         announcements, content, audit
    api/                 /api/auth/*, /api/account/*, /api/admin/[resource],
                         /api/downloads/[releaseId], /api/support/ticket
wrangler.toml            Pages compatibility settings (nodejs_compat, KV placeholder)
```

---

## Content management

Marketing copy and the catalog are **data-driven**, not scattered through
components:

| Content | File | Admin-managed copy |
| --- | --- | --- |
| Site config (name, links, nav) | `src/config/site.ts` | Site Content page |
| Products | `src/content/products.ts` | Products page |
| Plans / pricing | `src/content/plans.ts` | Plans page |
| Features | `src/content/products.ts` + `src/content/features.ts` | Products page |
| Releases / changelog | `src/content/changelog.ts` | Releases page |
| FAQ | `src/content/faq.ts` | FAQs page |
| Announcements | `src/content/announcements.ts` | Announcements page |
| Media gallery | `src/content/media.ts` | (images) |
| Legal | `src/content/legal.ts` | — |

Server-rendered pages read **database-first** (`catalog.ts`): if the store is
available, admin edits win; otherwise the static content ships as the fallback.
That means a product or release created in the admin panel appears on the public
site immediately in dev — and after a rebuild in production.

### Placeholders

Anything not yet final uses an obvious placeholder — `[DISCORD_LINK]`,
`[SUPPORT_LINK]`, `[RELEASE_SHA256]`, screenshot SVGs marked *"replace with
real screenshot"*. No fake production links, no invented statistics, no fake
payment success.

---

## Security model

The browser is never trusted. Everything sensitive is enforced server-side:

- **Passwords** — PBKDF2-SHA256 (Web Crypto) with per-user random salt and
  310k iterations. Constant-time comparison. No plaintext anywhere. Google-only
  accounts have no password until the user sets one in Settings.
- **Google OAuth** — authorization code flow with PKCE, a random `state` bound
  to a short-lived HttpOnly cookie, and an ID-token `nonce` checked against the
  verified token (issuer, audience, expiry). The client secret never leaves the
  server. Account linking is safe: an existing account is linked only when its
  email is already verified — never merged from an unverified claim.
- **Sessions** — random 32-byte tokens stored in the DB; the cookie holds
  `token.hmac` signed with `AUTH_SECRET`. `HttpOnly`, `SameSite=Lax`,
  `Secure` in production, 30-day expiry.
- **CSRF** — `SameSite=Lax` cookies plus an Origin / `Sec-Fetch-Site` check on
  every state-changing request.
- **Rate limiting** — in-memory limiter on signin/signup/forgot/reset/resend/support
  (single integration point; swap for KV/WAF in production).
- **Email verification** — accounts start unverified; a single-use, expiring
  token is emailed (24 h). Tokens are invalidated when a new one is issued,
  consumed exactly once, and required before protected downloads. Email changes
  also require verification of the new address. `sendEmail` reports delivery
  honestly — a "we sent it" message is never shown for a failed send.
- **Roles** — `user → moderator/support → admin → owner`, enforced in API
  guards (`requireAdmin`) and SSR page guards. Role changes respect rank.
- **Admin audit log** — every admin mutation records actor, action, resource,
  details, IP, timestamp (visible in the admin panel → Audit Log).
- **Hidden admin panel** — lives at a non-obvious path (see `CUSTOMIZE.md`),
  is never linked from public pages, and is excluded from `robots.txt`, the
  sitemap, and search-engine indexing. Access is enforced server-side.
- **Protected downloads** — `/api/downloads/[releaseId]` checks: session →
  published release → **server-side entitlement** → private storage. Files are
  never placed in `public/`. Placeholder assets live in `data/storage` (dev).
- **Headers & CSP** — strict CSP, `X-Frame-Options: DENY`, nosniff, referrer
  policy, permissions policy, HSTS — applied by middleware to every response
  and `public/_headers` for static assets.
- **Secrets** — `.env` is gitignored; only `.env.example` (placeholders) is
  committed. `AUTH_SECRET` must be a Cloudflare secret binding in production.

> In this foundation, the JSON-file store is **development only**. Until a real
> database binding is wired, production API/admin routes return a clean
> `503 backend_not_configured` — the public site keeps working from static
> content. See [Production backend](#production-backend).

---

## Authentication

Real, server-side authentication with two sign-in methods. The frontend never
decides whether a login succeeded — every decision is made by the backend.

### Email + password

- **Registration** — display name, email (normalized lowercase, syntax-checked,
  uniqueness-checked), password (≥ 8 chars) + confirmation with live strength
  feedback. Accounts are created **unverified**; the user is signed in and
  taken to `/auth/check-email`.
- **Verification** — a secure random, single-use, 24 h token is emailed
  (`/auth/verify-email?token=…`). Reusing a link, an expired link, or an
  unknown token each get a distinct, honest error state. A resend button lives
  in Settings (rate-limited, invalidates previous tokens).
- **Sign in** — wrong credentials and account-enumeration-safe messaging;
  unverified users still sign in but see a banner and cannot download releases
  until their email is verified.
- **Password reset** — `/auth/forgot-password` responds identically whether or
  not the email exists (no enumeration); a single-use 1 h token is emailed.
  Resetting invalidates the token and **all existing sessions**.
- **Email change** — Settings → Email. The new address is not adopted until
  its own verification link is clicked; the old address keeps working until
  then. Duplicate-email and delivery-failure cases are handled server-side.

### Google OAuth

1. Create an OAuth 2.0 **Web application** client at
   [console.cloud.google.com/apis/credentials](https://console.cloud.google.com/apis/credentials).
2. Add the authorized redirect URI — exactly
   `https://<your-domain>/api/auth/google/callback` (locally
   `http://127.0.0.1:4321/api/auth/google/callback`).
3. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` in
   your environment (secret stays server-side).

The flow uses the authorization code grant with **PKCE**, a random `state` in a
short-lived HttpOnly cookie, and an ID-token `nonce` (issuer, audience, expiry
and `email_verified` all checked before anything is trusted). Account linking is
safe: an existing account is linked to Google only when its email is already
verified; Google-only accounts can add a password in Settings, and
password-first accounts can connect Google from Settings → Sign-in methods.

### Email delivery

`EMAIL_TRANSPORT` selects the transport (see `.env.example`):

- `console` (default) — emails print to the dev server log so flows can be
  tested end-to-end without a provider. **Nothing is actually sent.**
- `smtp` — nodemailer against any SMTP host (dev / self-hosted; **not**
  available on Cloudflare Workers).
- `http` — generic transactional API (Resend-compatible): `POST
  {EMAIL_API_URL}/emails` with a bearer `EMAIL_API_KEY`. Use this on Cloudflare.

Templates are Zenith-branded (logo, button, fallback URL, expiry, security
note) in `src/lib/server/email.ts`. `sendEmail` returns a result and callers
surface failures honestly — the site never claims an email was sent when it
wasn't.

### Testing locally

`npm test` runs vitest suites covering the security-critical logic: token
single-use/expiry, OAuth account linking rules (verified/unverified email
conflict, case normalization), and ID-token validation (state, nonce, audience,
issuer) with a mocked Google token endpoint. The dev server exercises the full
HTTP flows: signup → check-email → verify (token in the dev log) → downloads;
reset with session invalidation; rate limits; admin guards.

**Still requires your real credentials before production:** a Google OAuth
client, an email provider, and the production database. Until then the Google
button is hidden (or shows an honest error when misconfigured) and the dev
console transport is used.

---

## Admin panel

The panel is intentionally unadvertised — the path is documented in
`CUSTOMIZE.md` (the route prefix is `/hq`). It is server-guarded; role must be
`admin` or `owner`:

- **Dashboard** — user/subscription/product/release counts, recent activity.
- **Users** — search, role management, suspend/reinstate (suspension signs the
  user out immediately).
- **Products / Plans / Releases / FAQs / Announcements** — full CRUD with
  draft/published states; releases support scheduled dates and entitlement
  requirements.
- **Site Content** — hero copy, CTA labels, Discord/support links, banner
  (whitelisted fields only — no raw code editing).
- **Audit Log** — immutable record of admin actions.

Normal users hitting the panel are sent to the styled denial page; API admin
routes return 403.

---

## Commerce & entitlements

The domain model separates **user → product → plan → purchase / subscription →
entitlement → release**:

- A user *owns* a product via a paid permanent purchase **or** an active
  subscription (`hasEntitlement` — server-side only).
- The checkout page (`/checkout/[planId]`) is an honest order summary: **no
  payment provider is connected**, so no payment is processed and no
  entitlement is granted. It displays the exact provider-abstraction point.
- When a provider is added: validate webhook signatures, make handlers
  idempotent, and update `purchases`/`subscriptions` **only from verified
  server events** — never from the browser.
- Cancellation flows exist in the account portal as the server-side contract
  for the future provider.

---

## Production backend

The `Store` interface (`src/lib/server/store.ts`) is the seam. Dev uses
`JsonFileStore` (`data/db.json`, auto-seeded). To go live:

1. **Database** — add a `DB` D1 binding in `wrangler.toml` (commented
   template included) and implement a `D1Store` (or use KV/R2 + a hosted DB
   behind a Worker). Keep the same `db()` / `mutate()` contract. Runtime env
   vars/secrets set in the Pages dashboard are already readable via
   `import.meta.env` on server routes — no code changes needed.
2. **Auth** — set `AUTH_SECRET` as a Cloudflare secret binding; keep the
   session cookie flow (or swap in a provider).
3. **Email** — set `EMAIL_TRANSPORT` (see [Authentication](#authentication)).
   Dev prints emails to the console; SMTP and a Resend-compatible HTTP transport
   are implemented. Production on Cloudflare should use the `http` transport.
4. **Payments** — see [Commerce](#commerce--entitlements).
5. **Storage** — implement `getStoredAsset` in `src/lib/server/storage.ts` with
   R2 signed URLs; keep the entitlement checks in the download endpoint.
6. **Rate limiting** — replace the in-memory limiter with Cloudflare Rate
   Limiting or KV-based counters.

---

## Deployment — Cloudflare Pages

The project is built to deploy to **Cloudflare Pages** by connecting the GitHub
repo — no manual code changes required afterwards. `wrangler.toml` declares the
build output (`pages_build_output_dir = "dist"`) and compatibility flags, and
Pages applies them automatically.

### One-time setup in the Cloudflare dashboard

1. **Workers & Pages → Create → Pages → Connect to Git** and pick this repo
   (the build settings below are read from the repo; they can also be set in
   the dashboard).
2. **Build command:** `npm run build` · **Build output directory:** `dist` ·
   **Node.js version:** `20` (set a `NODE_VERSION` environment variable to `20`
   if the default build environment is older).
3. **Environment variables** (Pages project → Settings → Environment
   variables). Anything that is a secret should be added as a **secret**
   (masked), not a plain variable:

   | Variable | Type | Notes |
   | --- | --- | --- |
   | `AUTH_SECRET` | secret | Long random hex (`openssl rand -hex 32`). Session cookie signing. |
   | `PUBLIC_SITE_URL` | plain | `https://zenith.pages.dev` (or your custom domain) — used for absolute links in emails. |
   | `GOOGLE_CLIENT_ID` | plain | Google OAuth — see [Authentication](#authentication). |
   | `GOOGLE_CLIENT_SECRET` | secret | Google OAuth client secret (never client-side). |
   | `GOOGLE_REDIRECT_URI` | plain | Must exactly match a redirect URI authorized in Google Console. |
   | `EMAIL_TRANSPORT` | plain | `http` on Cloudflare (SMTP is not available on Workers). |
   | `EMAIL_FROM` / `EMAIL_FROM_NAME` | plain | Sender address/name. |
   | `EMAIL_API_URL` / `EMAIL_API_KEY` | secret | Transactional email API (e.g. Resend). |

   Env vars and secrets set in the dashboard are available **server-side at
   runtime** on Cloudflare — the built worker reads them through
   `import.meta.env` on on-demand routes (verified with `wrangler pages dev`).
   Only `PUBLIC_`-prefixed variables are ever exposed to the browser.
4. **Deploy.** Pages runs `npm run build` and serves `dist/`; the marketing
   pages, account/auth/admin routes, and APIs all run through the generated
   worker. Security headers are applied by middleware to every response and by
   `public/_headers` to static assets.

### What works on first deploy — and what doesn't yet

- ✅ The public site (home, products, features, changelog, FAQ, support,
  community, media, legal) — fully server-rendered with the signed-in header.
- ✅ Google OAuth start/callback and email sending are **fully implemented**;
  they become active once the Google + email credentials above are set.
- ⚠️ Account creation, sign-in, the account portal, the admin panel, and
  protected downloads **need a database**. Until one is connected, those
  routes return a clean `503 backend_not_configured` (never a crash, no stack
  traces). See [Production backend](#production-backend) — the `Store`
  interface is the seam; a Cloudflare **D1** binding + `D1Store`
  implementation is the planned path.
- ⚠️ No payment provider is connected (checkout is an honest order summary).

### Custom domain

When you add a custom domain (e.g. `zenith.vip`) in **Pages → Custom domains**, update:

- `site` in `astro.config.mjs` and `src/config/site.ts` → the new domain
  (regenerates sitemap + canonical URLs), and
- `PUBLIC_SITE_URL` and `GOOGLE_REDIRECT_URI` env vars (plus the matching
  redirect URI in Google Console).

Then rebuild/redeploy. No other code changes are needed.

### Local production preview

Run the exact production worker locally (useful before deploying):

```bash
npm run build
npx wrangler pages dev dist --binding AUTH_SECRET=dev-secret \
  --binding PUBLIC_SITE_URL=http://localhost:8788
# → http://localhost:8788
```

`wrangler` also loads your local `.env`, so real-looking local credentials
work here too. Static assets are served from `dist/` and everything else runs
through the bundled worker — the same split Cloudflare uses in production.

---

## Assets

| Task | Command |
| --- | --- |
| Regenerate favicon / OG / apple-touch icons from the source logo | `npm run assets:favicon` |
| Regenerate transparent logo variants (png + webp) | `npm run assets:logo` |
| Regenerate screenshot placeholders | `node scripts/make-media-placeholders.mjs` |

The **source logo** is `public/logo/source/zenith-logo-on-black.png` (the
original, never modified). Variants derive from it — favicons are letterboxed
squares on black; the site uses a transparent-background webp so the wordmark
sits cleanly on dark surfaces. To ship new logo files, drop them in and rerun
the scripts; the components only reference `/logo/*` paths.

---

## Environment variables

See `.env.example` for the full annotated list. Summary:

| Variable | Purpose | Default (dev) |
| --- | --- | --- |
| `AUTH_SECRET` | HMAC signing for session cookies (required in prod) | dev fallback |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | Seed owner account | `admin@zenith.local` / `zenith-dev-admin` |
| `PUBLIC_SITE_URL` | Absolute URLs in emails | request origin |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REDIRECT_URI` | Google OAuth (server-side only) | unset → Google button hidden |
| `EMAIL_TRANSPORT` | `console` / `smtp` / `http` | `console` (dev) |
| `EMAIL_FROM` / `EMAIL_FROM_NAME` | Sender address/name | `no-reply@zenith.pages.dev` |
| `SMTP_*` | SMTP connection (when `EMAIL_TRANSPORT=smtp`) | — |
| `EMAIL_API_URL` / `EMAIL_API_KEY` | HTTP email API (when `EMAIL_TRANSPORT=http`) | — |
| `DATABASE_PROVIDER` / `DATABASE_URL` | Future DB | `json` |
| `PAYMENT_*`, `R2_*` | Future integrations | placeholders only |

---

## Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Dev server with seeded local DB |
| `npm run build` | Production build → `dist` |
| `npm run preview` | Preview the production build locally |
| `npm run typecheck` | `astro check` (strict TS across src) |
| `npm test` | Run the vitest unit tests (auth tokens, OAuth linking) |
| `npm run seed` | Re-seed a fresh dev database (deletes `data/db.json`) |

---

## License / affiliation

Zenith is an independent project. It is **not affiliated with, endorsed by, or
connected to Mojang Studios or Microsoft**. Minecraft is a trademark of Mojang
Studios.
