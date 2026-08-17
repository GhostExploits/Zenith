# Zenith — Official Website

The official website for **Zenith**, a premium Minecraft client. This repository
contains the public site, the account portal, the commerce architecture, and a
secure admin foundation — built to deploy on Cloudflare Pages.

> **Status: production backend ready.** Public site, real authentication
> (email/password + Google OAuth, email verification), entitlements, license
> keys, protected downloads, payments (Paddle), the admin panel, and the
> **Zenith client license authority** are implemented. Payments ship in
> **maintenance mode** (`PAYMENTS_ENABLED=false` by default) — the store is
> fully browsable but nobody can be charged until the flag is deliberately
> enabled alongside the Paddle credentials. The production stack is
> Cloudflare D1 (database), Cloudflare R2 (private release files) and Paddle
> (payments). Licenses are Ed25519-signed entitlements the Zenith V2 client
> verifies locally, with one-PC device binding. What remains to go live is
> one-time configuration with your own credentials — creating the D1 database
> and R2 bucket, plus the Google/Paddle/email secrets and the license signing
> key. See `DEPLOY.md` for the exact steps. Until those bindings exist,
> affected routes return a clean `503 backend_not_configured` and the public
> site keeps serving from static content.

> **Owner guides:** [`CUSTOMIZE.md`](CUSTOMIZE.md) — where to edit text,
> screenshots, colors, and how to use the admin panel. [`DEPLOY.md`](DEPLOY.md)
> — step-by-step Cloudflare Pages publishing (connect this GitHub repo; you do
> not upload a static folder).

---

## Quick start

```bash
npm install

# Development (creates a seeded local database on first run:
# data/db.json + data/storage; the current release build is already staged
# under data/storage/rel-z2-042 — delete data/ to re-seed)
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
      store.ts           DB abstraction: JSON-file store (dev) + D1 store (prod)
      authority.ts       License authority: canonical payload + Ed25519 signing
                         (the contract the Zenith client verifies locally)
      licenses.ts        License system: ZEN- keys, device binding, activation,
                         status checks, admin lifecycle
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
                         /api/downloads/[releaseId], /api/support/ticket,
                         /loader/login, /license/status, /license/activate,
                         /license/public-key (client + loader authority)
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
  (single integration point; swap for KV/WAF in production). Every attempt
  counts — successful signups/verifications are rate-limited too, not just
  failures.
- **Payment maintenance mode** — payments are **disabled by default**
  (`PAYMENTS_ENABLED` unset or `false`). Even if Paddle credentials are
  present, no checkout is created, no provider API is called, and webhooks are
  ignored until the owner deliberately sets `PAYMENTS_ENABLED=true`. The
  checkout page shows a "Payments under maintenance" state and never collects
  card details; only the actual purchase action is blocked.
- **Email verification** — accounts start unverified; a single-use, expiring
  token is emailed (24 h). Tokens are invalidated when a new one is issued,
  consumed exactly once, and required before protected downloads. Email changes
  also require verification of the new address. `sendEmail` reports delivery
  honestly — a "we sent it" message is never shown for a failed send.
- **License authority** — the website is the remote license authority for the
  Zenith client. Licenses are canonical payloads signed with the owner's
  Ed25519 key (the client verifies them locally against the key embedded in
  the client). Device binding (max 1 PC) is enforced server-side; only the
  owner can reset a binding. All license endpoints are rate-limited.
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

**If Google shows "Authorization not configured" (403 access_denied)** after
clicking "Continue with Google": that message is **not produced by this site**
(it does not exist in this codebase) — it comes from Google's own OAuth server
and means the **Google Cloud Console project** is not fully set up. Fix it
there:

1. Configure the **OAuth consent screen** (APIs & Services → OAuth consent
   screen): app name, support email, and the `email`/`profile` scopes. While
   the app is in "Testing" status, add the email you sign in with under
   **Test users**.
2. Create the **OAuth client** in the *same* project (APIs & Services →
   Credentials → OAuth client ID → Web application) and add the authorized
   redirect URI — it must match `GOOGLE_REDIRECT_URI` **character-for-character**
   (no trailing slash, same protocol/domain).
3. Email + password signup works regardless — it never touches Google.

Sign in with `/hq` as the owner and open **Setup Status** for a live readout
of whether Google OAuth, payments, the license key, email and storage are
configured.

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

- **Dashboard** — users, revenue, paid orders, active subscriptions, active
  licenses, unread notifications, failed payments; recent purchases,
  registrations, licenses and admin activity.
- **Orders** — every purchase/renewal from verified payment events with
  revenue stats and search (customer, plan, reference).
- **Licenses** — search keys/emails/plans, view tier, device binding (bound
  machine, last seen, client version), issue (assign to an account + plan),
  revoke, suspend, reactivate, extend, change tier, **reset device binding**
  (transfer to a new PC), delete — all audited and notified.
- **Notifications** — owner-facing events (purchase, refund, failed payment,
  subscription, license, webhook errors).
- **Users** — search, role management, suspend/reinstate (suspension signs the
  user out immediately).
- **Products / Plans / Releases / FAQs / Announcements** — full CRUD with
  draft/published states; plans configure the license mode (permanent vs
  subscription-period); releases support file upload to private R2 storage
  (filename, size and SHA-256 computed server-side).
- **Site Content** — hero copy, CTA labels, Discord/support links, banner
  (whitelisted fields only — no raw code editing).
- **Audit Log** — immutable record of admin actions.Normal users hitting the panel are sent to the styled denial page; API
admin routes return 403.

---

## Managing Zenith from your phone

The whole admin panel is **mobile-friendly** — you can run the business from
your phone: check orders, issue or reset licenses, change pricing, upload
releases, and read notifications.

### Opening the panel on your phone

1. Open **any phone browser** (Chrome, Safari) and go to:
   `https://zenithv2.pages.dev/hq` (or your custom domain + `/hq`).
2. **Sign in with your owner account** — the same one you set as `ADMIN_EMAIL`
   (either the "Continue with Google" button or your email + `ADMIN_PASSWORD`).
   The panel only works for you; anyone else is shown a "Not allowed" page.
3. Done — everything below works in the same browser. Add the page to your
   home screen ("Add to Home Screen" in the browser menu) for a full-screen
   app-like shortcut.

> The panel is **not linked anywhere on the public site** and is excluded from
> search engines on purpose. Bookmark it — don't paste the link into chat
> servers or support threads.

### The mobile layout

- **Top bar** under the site header shows the section you're in. Tap the
  **hamburger button (☰)** on the left to open the full menu drawer —
  Dashboard, Orders, Licenses, Users, Products, Plans, Releases, FAQs,
  Announcements, Site Content, Notifications, Audit Log. Tap anywhere outside
  the drawer (or press back) to close it.
- **Tables** (orders, licenses, users…) scroll sideways on phones; the first
  column — the customer's email, the license key, the product name — stays
  **pinned on the left** while you swipe to reach the action buttons.
- **Buttons and forms** stretch to full width on phones, so there's no
  fiddly tapping.

### What you can do from your phone

| Section | What you can do |
| --- | --- |
| **Dashboard** (`/hq`) | Revenue, users, active licenses, failed payments, recent activity — at a glance. |
| **Orders** (`/hq/orders`) | Every purchase with customer, plan, amount, status; search by email/plan/reference. |
| **Licenses** (`/hq/licenses`) | Issue a license to any account, revoke, suspend, reactivate, extend (+days), **change tier**, and **reset a device binding** (see below). Search by key/email/plan. |
| **Users** (`/hq/users`) | Find users, change roles, suspend/reinstate (suspending signs them out immediately). |
| **Products** (`/hq/products`) | Edit product pages, toggle availability, manage the catalog. |
| **Plans** (`/hq/plans`) | Edit the four tiers' prices, billing interval, features, and license mode — price changes apply to checkout instantly. |
| **Releases** (`/hq/releases`) | Publish changelog entries and **upload the download file** (filename, size and SHA-256 are computed server-side). |
| **FAQs / Announcements** | Add or edit support content and banner announcements. |
| **Site Content** (`/hq/content`) | Change hero copy, CTA labels, Discord/support links, announcement banner. |
| **Notifications** (`/hq/notifications`) | Purchase, refund, failed-payment, license-activation, and webhook-error events. |
| **Audit Log** (`/hq/audit`) | Every admin action, with actor, time and IP. |

### Resetting a customer's device/license binding

Each license is bound to **one PC** (the machine that first activated it). When
someone switches computers, you transfer the license like this:

1. `/hq` → **Licenses**.
2. Search for the license key or the customer's email.
3. Tap **Reset device** on that row (it appears when the license is bound).
4. Confirm. The license is unbound and can be activated on the new PC.

Customers can't reset their own binding — that's what stops one key being
shared across machines. If someone asks, do it for them here. Revoking a
license kicks the client immediately; extending adds days to its expiry.

### Security notes for phone use

- The panel is protected by the site's normal session cookie (HttpOnly,
  `SameSite=Lax`, HTTPS). Signing in on a phone is as safe as on a desktop.
- **Use a strong `ADMIN_PASSWORD`** (set as a Cloudflare secret), and prefer
  Google sign-in with your personal account so there's nothing extra to
  remember.
- If you sign in on a shared/borrowed device, use the **Sign out** button in
  the header (Account → Sign out) when you're done.
- The admin API routes reject anyone without an admin/owner session (403),
  even if they guess the URL — the panel is never protected by obscurity alone.
- **Never commit** `AUTH_SECRET`, `ADMIN_PASSWORD`, `LICENSE_SIGNING_KEY`, or
  any other secret to git. They live in Cloudflare's secret store.

### What must be configured first (one-time)

The panel reads and writes the production database, so it only works after the
backend is live. You need, once (details in [`DEPLOY.md`](DEPLOY.md)):

1. **Cloudflare D1** database created + `database_id` in `wrangler.toml`
   (`npm run db:create` → `npm run db:migrate`), and the **R2** release bucket
   (`npm run r2:create`).
2. **Secrets** in the Cloudflare dashboard: `AUTH_SECRET`, `ADMIN_EMAIL`
   (your email — this is what makes *you* the owner), `ADMIN_PASSWORD`,
   `LICENSE_SIGNING_KEY` + `LICENSE_SIGNING_PUBLIC_KEY`, and the Google/Paddle
   credentials.
3. **A deploy.** Push to GitHub and let Cloudflare Pages build it, or run
   `npm run build` and deploy the `dist/` output.

If a section shows an empty state or an error like "backend not configured",
that means one of the steps above is missing — the site itself keeps working,
but the panel can't read the database yet.

---

## Commerce, payments & licenses

The domain model separates **user → product → plan → purchase / subscription →
license → entitlement → release**:

- **Payments ship in maintenance mode.** They run on Paddle (a Merchant of
  Record) once enabled, but by default (`PAYMENTS_ENABLED` unset/false) the
  site shows a "Payments under maintenance" state on the checkout page, and
  the checkout API returns `503 payments_maintenance` — no transaction is
  created, no provider is contacted, no webhook is processed, and no card
  details are ever requested. Setting `PAYMENTS_ENABLED=true` (plus the Paddle
  credentials) is the deliberate switch to go live; nothing else needs to
  change.
- **Payments run on Paddle**, a Merchant of Record: it collects payment,
  handles global taxes, and never lets card data touch this server. The server
  creates a hosted checkout from the database plan (price edits in the admin
  panel apply immediately via inline prices) and redirects the buyer.
- **The browser is never trusted with a payment.** Entitlements, purchases,
  subscriptions and license keys are created **only** in the webhook handler
  (`/api/payments/webhook`) after HMAC-SHA256 signature verification of the
  raw body (`Paddle-Signature`), with a timestamp replay window. Handlers are
  idempotent — re-delivered webhooks never double-grant.
- **Licenses** are generated automatically from verified purchases
  (`ZEN-XXXX-XXXX-XXXX`, matching the Zenith client's key format): each is a
  **signed entitlement** (Ed25519) carrying the tier (Bronze / Silver / Gold /
  Diamond), product, expiry and recipient. Subscription tiers get a license
  tied to the active period (renewals re-sign and extend it); permanent tiers
  (Gold) get a license that never expires. The owner can also issue/revoke/
  extend/suspend/retier licenses and **reset device bindings** from the admin
  panel (`/hq/licenses`). See [License authority](#license-authority).
- **Protected downloads** are gated server-side per request by entitlement
  (active subscription **or** paid permanent purchase) and streamed from
  private R2 storage — never from a public URL.
- **Owner notifications** for purchases, refunds, failed payments, license
  events and webhook errors are recorded in the database and shown in the
  admin panel (`/hq/notifications`).
- Cancellation flows in the account portal call the provider first and only
  reflect provider-confirmed state.

---

## License authority

The Zenith V2 client verifies every license **locally**: the owner's Ed25519
public key is embedded in the client, and a license is a canonical entitlement
payload signed with the matching private key. This website is the **remote
license authority** — it implements the same HTTP contract the local VapeService
used, so the unmodified client and loader work against it:

| Endpoint | Who calls it | What it does |
| --- | --- | --- |
| `POST /loader/login` | Loader | Validate the key, **bind it to the PC** on first use (max 1 device), return a session token |
| `POST /license/status` | Client | Validate status/expiry/binding, return the signed entitlement payload the client verifies |
| `POST /license/activate` | (contract parity) | Same as status but binds the device |
| `GET /license/public-key` | Tooling | The authority's public key as PEM |

Every license issued by a verified payment (or from the admin panel) is signed
with the owner's key. The payload format is byte-identical to the VapeService
implementation (`src/lib/server/authority.ts`), so a license bought on the site
works in the real client without modification.

**Device binding:** a license binds to one machine fingerprint
(SHA-256 of `zenith-v2:` + Windows MachineGuid) on first activation. The same
key on a second PC is rejected with `LICENSE_BOUND_OTHER`. Customers cannot
reset their own binding (that would let one key be shared); the owner does it
from the admin panel (`/hq/licenses` → Reset device), which is the workflow for
transferring a license to a new PC.

**Keys:** `ZEN-XXXX-XXXX-XXXX` (the existing VapeService format). Tier values
are the client's own set — Bronze / Silver / Gold / Diamond — so module gating
works. Status/expiry changes that are part of the signed payload (extend, tier
change, renewal) **re-sign** the entitlement automatically; status changes
(revoke/suspend) don't need to, which is why a revoked license can never unlock
the client.

**Signing key:** set `LICENSE_SIGNING_KEY` (PKCS8 PEM, from
`VapeService/data/license-signing.key`) and `LICENSE_SIGNING_PUBLIC_KEY`
(`license-signing.pub`) as Cloudflare secrets. Without them, development uses an
ephemeral key and the admin panel shows a warning — real clients will reject
those licenses.

---

## Production backend

The `Store` interface (`src/lib/server/store.ts`) is the seam and the
production store is **implemented**: `D1Store` persists the domain document in
one row of a Cloudflare D1 database (SQLite). Reads are cached per worker
isolate and refreshed by middleware on every request; writes are serialized and
use an optimistic compare-and-swap retry loop, so concurrent isolates never
lose an update. Dev continues to use `JsonFileStore` (`data/db.json`,
auto-seeded).

To go live:

1. **Database (D1)** — `npm run db:create` (or create in the dashboard), paste
   the returned `database_id` into `wrangler.toml`, then `npm run db:migrate`.
   On first use the store seeds itself: the catalog plus the owner account
   from `ADMIN_EMAIL` / `ADMIN_PASSWORD` (set both as Cloudflare secrets). No
   demo data is ever seeded in production.
2. **Storage (R2)** — `npm run r2:create` (or create the bucket in the
   dashboard). Release files uploaded from the admin panel are stored there
   and streamed by the download endpoint after entitlement checks.
3. **Payments (Paddle)** — see [Commerce](#commerce--entitlements); set
   `PADDLE_API_KEY` + `PADDLE_WEBHOOK_SECRET` as Cloudflare secrets.
4. **Auth** — `AUTH_SECRET` as a Cloudflare secret binding; the session
   cookie flow works as-is.
5. **Email** — `EMAIL_TRANSPORT=http` on Cloudflare with `EMAIL_API_URL` /
   `EMAIL_API_KEY` (e.g. Resend). License keys are emailed to buyers on
   purchase when email is configured.
6. **License authority** — set `LICENSE_SIGNING_KEY` (the PKCS8 PEM from
   `VapeService/data/license-signing.key`) and `LICENSE_SIGNING_PUBLIC_KEY`
   (the matching `.pub`) as Cloudflare secrets. Without the real key the site
   works but real Zenith clients reject the licenses. See
   [License authority](#license-authority).
7. **Rate limiting** — the in-memory limiter works per isolate; pair it with
   Cloudflare Rate Limiting rules for a hard global cap.

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
   | `LICENSE_SIGNING_KEY` | secret | PKCS8 PEM private key from `VapeService/data/license-signing.key`. Clients reject licenses signed by any other key. |
   | `LICENSE_SIGNING_PUBLIC_KEY` | secret | X.509 PEM public key (`license-signing.pub`) — enables stored-license tamper checks. |

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
| `PAYMENTS_ENABLED` | Master switch: `true` turns payments live (requires Paddle keys too) | `false` — maintenance mode, no charges possible |
| `PAYMENT_PROVIDER`, `PADDLE_API_KEY`, `PADDLE_WEBHOOK_SECRET` | Paddle credentials (ignored while `PAYMENTS_ENABLED` is off) | placeholders |
| `R2_*` | Future storage integrations | placeholders only |
| `LICENSE_SIGNING_KEY` / `LICENSE_SIGNING_PUBLIC_KEY` | License authority Ed25519 keypair (see [License authority](#license-authority)) | ephemeral dev key |

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
