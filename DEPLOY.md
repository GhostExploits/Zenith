# Deploying Zenith to Cloudflare Pages

Zenith is an **Astro** project that builds to static files + a server worker.
It is designed to run on **Cloudflare Pages** (free tier is fine). You connect
**this GitHub repository** to Cloudflare — you do *not* upload a static file.

> Short answer to "static file or repo?": **connect the repo.** Cloudflare
> builds the project itself on every push. Uploading a static folder would
> miss the login system, the account area, and the admin panel entirely.

---

## Step 1 — Push the repo to GitHub

1. Create a **private** repository on GitHub (private is safer while it has no
   real users; it can be made public later).
2. Push this project to it:
   ```bash
   git remote add origin https://github.com/<you>/<repo>.git
   git push -u origin main
   ```
   (Or upload the folder through the GitHub web interface → "uploading an
   existing file" works too, but git is cleaner.)

## Step 2 — Create the Pages project

> **Important: create a *Pages* project, not a *Workers* project.** Under
> **Workers & Pages → Create** there are two tabs — pick **Pages**.
> A **Workers** project runs `npx wrangler deploy`, which is the wrong
> deployer for this repo (and fails on older Node versions). Pages serves
> the `dist/` output directly and needs no deploy command. If you already
> created a Workers project, delete it and create a Pages one.

1. Log in to [dash.cloudflare.com](https://dash.cloudflare.com) → **Workers &
   Pages** (left menu) → **Create** → tab **Pages** → **Connect to Git**.
2. Pick your GitHub account and the repo.
3. Build settings:
   - **Framework preset:** `Astro`
   - **Build command:** `npm run build`
   - **Build output directory:** `dist`
   - Leave everything else default.
4. Click **Save and Deploy**. First build takes ~1–2 minutes. When it finishes
   you get a URL like `https://<project>.pages.dev`.

Node version: the repo pins Node 22 (`.nvmrc`), which the toolchain needs.

> The `wrangler.toml` file in the repo already sets the output dir and
> compatibility flags, so no extra configuration is needed.

## Step 3 — Create the database and storage (required for the backend)

The backend needs two Cloudflare resources. Create them once; the app reads
them through the bindings already declared in `wrangler.toml`.

```bash
# 1. Database (D1)
npm run db:create          # prints a database_id
```
Paste the printed `database_id` into `wrangler.toml` (the `[[d1_databases]]`
block — replace `YOUR_D1_DATABASE_ID`). Then:

```bash
npm run db:migrate         # creates the store table in the remote database
npm run r2:create          # creates the private release bucket (R2)
```

Or do all three from the dashboard: **Workers & Pages → D1 → Create database**
(name it `zenith`), **R2 → Create bucket** (name it `zenith-releases`), then
set the `database_id` in `wrangler.toml`. The build fails until the ID is
real — that's deliberate, so the setup can't be skipped by accident.

> First request to the database seeds it: the product catalog and your owner
> account (from `ADMIN_EMAIL` / `ADMIN_PASSWORD`). No demo data is ever
> created in production.

## Step 4 — Add environment variables & secrets

Go to the Pages project → **Settings → Environment variables** and add these
(anything marked secret should be added as a **secret**, not a plain value):

| Variable | Type | Value |
| --- | --- | --- |
| `PUBLIC_SITE_URL` | plain | `https://<your-project>.pages.dev` (or your custom domain) |
| `AUTH_SECRET` | **secret** | a long random hex string — run `openssl rand -hex 32` (or any 64-char random string) |
| `ADMIN_EMAIL` | plain | the email you'll use to sign in to `/hq` |
| `ADMIN_PASSWORD` | **secret** | a strong password for that account |
| `GOOGLE_CLIENT_ID` | plain | Google OAuth client ID (Step 5) |
| `GOOGLE_CLIENT_SECRET` | **secret** | Google OAuth client secret |
| `GOOGLE_REDIRECT_URI` | plain | `https://<your-project>.pages.dev/api/auth/google/callback` |
| `PAYMENTS_ENABLED` | plain | **`false` (default — leave unset).** Payments stay in maintenance mode until you deliberately set `true`; nobody can be charged, no provider API is called, and webhooks are ignored while it's off. Set it to `true` only when you have completed Step 6 and are ready to take real orders. |
| `PADDLE_API_KEY` | **secret** | Paddle API key (Step 6) — ignored while `PAYMENTS_ENABLED` is off |
| `PADDLE_WEBHOOK_SECRET` | **secret** | Paddle notification secret (Step 6) — ignored while `PAYMENTS_ENABLED` is off |
| `EMAIL_TRANSPORT` | plain | `http` (recommended) or `console` (emails just print to logs — fine for testing) |
| `EMAIL_FROM` / `EMAIL_FROM_NAME` | plain | sender address/name |
| `EMAIL_API_URL` / `EMAIL_API_KEY` | plain / **secret** | transactional email API (e.g. Resend) when `EMAIL_TRANSPORT=http` |
| `LICENSE_SIGNING_KEY` | **secret** | the PKCS8 PEM **private key** from your VapeService data dir (`dist/service/data/license-signing.key`) — the key that matches the public key embedded in the Zenith client. Licenses are Ed25519-signed with it; any other key and real clients reject them |
| `LICENSE_SIGNING_PUBLIC_KEY` | **secret** | the matching public key (`dist/service/data/license-signing.pub`, X.509 PEM) — used for stored-license tamper checks |

Apply to **Production**. Redeploy (or the next push) picks them up.

> **License signing key — do not skip.** `LICENSE_SIGNING_KEY` is what makes
> licenses issued by the website actually unlock the Zenith client. The two
> files live in your VapeService build output (`dist/service/data/`). Never
> commit them to git. Until they are set, the admin panel shows a warning and
> licenses are signed with a throwaway dev key the client rejects.

## Step 5 — Google "Continue with Google" (optional but recommended)

1. Go to [console.cloud.google.com/apis/credentials](https://console.cloud.google.com/apis/credentials)
   → **Create credentials → OAuth client ID → Web application**.
2. Under **Authorized redirect URIs** add **exactly**:
   - `https://<your-project>.pages.dev/api/auth/google/callback`
   - (local testing) `http://127.0.0.1:4321/api/auth/google/callback`
3. Copy the **Client ID** and **Client secret** into the env vars above.
   The URI must match character-for-character or Google rejects login with
   `redirect_uri_mismatch`.

> **If Google shows "Authorization not configured" (403 access_denied):** that
> text is Google's own error — it is not produced by this codebase. It means the
> Google Cloud project is incomplete. Fix it in the console:
> (1) configure the **OAuth consent screen** (APIs & Services → OAuth consent
> screen — app name, support email, and for "Testing" status add the email you
> sign in with under **Test users**), and (2) make sure the OAuth client and the
> consent screen belong to the **same project**, with the redirect URI above
> added character-for-character. Email + password signup works without any of
> this. After deploying, sign in to `/hq` → **Setup Status** for a live
> readout of what the server sees.

## Step 6 — Paddle payments (required for checkout)

> Checkout stays in **maintenance mode until you set `PAYMENTS_ENABLED=true`**
> in the dashboard (Step 4). Until then the checkout page shows "Payments under
> maintenance", the checkout API returns `503 payments_maintenance`, and the
> Paddle credentials below are ignored — so you can complete this step safely
> and flip the switch only when you're ready to take real orders.

1. Sign up at [vendor.paddle.com](https://vendor.paddle.com). Paddle is a
   Merchant of Record — it collects payments, handles global taxes, and no
   card data ever reaches your server.
2. **Settings → API keys → Generate API key** (Paddle API). It needs
   `transactions` and `subscriptions` scopes. Paste into `PADDLE_API_KEY`.
3. **Developer tools → Notifications → Add destination**:
   - URL: `https://<your-project>.pages.dev/api/payments/webhook`
   - Secret key: generate one (it is shown once) and paste into
     `PADDLE_WEBHOOK_SECRET`.
   - Select **All** event types (the app ignores what it doesn't need).
4. Checkout works with **any currency** — prices are taken from the admin
   panel (Plans) at checkout time, so price edits apply immediately. No
   products/prices need to be created in the Paddle dashboard.

## Step 7 — Custom domain (later)

Pages project → **Custom domains** → add e.g. `zenith.vip` (DNS managed by
Cloudflare → it handles the record automatically). Then update
`PUBLIC_SITE_URL`, `GOOGLE_REDIRECT_URI` (+ the Google Console URI), and
`astro.config.mjs` → `site` to the new domain and redeploy.

## Step 8 — What works on deploy

- ✅ Public site, products, pricing (Bronze / Silver / Gold / Diamond),
  changelog, FAQ, media, legal, community.
- ✅ Accounts: email/password signup + Google login, email verification,
  account dashboard (products, subscriptions, licenses, downloads, settings).
- ✅ Checkout UI: signed-in users see the full order summary and plan details.
  ⚠️ By default the purchase button is **disabled (maintenance mode)** —
  `503 payments_maintenance` until you set `PAYMENTS_ENABLED=true` and add the
  Paddle credentials. Once enabled, signed-in users buy through Paddle's
  hosted checkout and verified payments automatically create the purchase,
  subscription (where applicable), a **signed** license key and an owner
  notification.
- ✅ **License authority**: `POST /loader/login`, `/license/status`,
  `/license/activate`, `/license/public-key` — the endpoints the Zenith loader
  and client call. Licenses bind to one PC (device fingerprint); cross-device
  use is rejected; the owner resets bindings from the admin panel.
- ✅ Downloads: entitled users (active subscription or permanent license)
  stream the **real release build** (Zenith V2 4.21: client jar + loader +
  native DLL + launcher script) from private R2 storage; every request is
  re-checked server-side.
- ✅ Admin panel at `/hq` (server-guarded — non-admins get the styled denial
  page): dashboard, orders, licenses (tier, device binding, reset-device),
  users, products, plans, releases (with file upload), FAQs, announcements,
  site content, notifications, audit log.

**Customers**: they download the build from their account → Downloads, extract
it, launch `Launch Zenith V2.bat` (which points the loader at this site), and
enter their license key. The loader binds the key to their PC on first use.

Everything depends on Steps 3, 4 and 6 being configured. Before that, those
routes return a clean `503 backend_not_configured` and the public site keeps
working from static content.

## Security settings worth enabling

- **Rate limiting**: dashboard → your domain → **Security → WAF → Rate limiting**
  (e.g. 20 requests/10s per IP on `/api/auth/*` and `/hq/*`) — the app already
  rate-limits internally, this adds a network-level cap.
- **Bot fight mode** / **Managed challenge** on the security level if you want.
- The admin panel is at `/hq` — keep it unlisted (it already is).
