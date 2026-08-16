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

1. Log in to [dash.cloudflare.com](https://dash.cloudflare.com) → **Workers &
   Pages** (left menu) → **Create** → **Pages** → **Connect to Git**.
2. Pick your GitHub account and the repo.
3. Build settings:
   - **Framework preset:** `Astro`
   - **Build command:** `npm run build`
   - **Build output directory:** `dist`
   - Leave everything else default.
4. Click **Save and Deploy**. First build takes ~1–2 minutes. When it finishes
   you get a URL like `https://<project>.pages.dev`.

> The `wrangler.toml` file in the repo already sets the output dir and
> compatibility flags, so no extra configuration is needed.

## Step 3 — Add environment variables & secrets

Go to the Pages project → **Settings → Environment variables** and add these
**before relying on login features** (the public pages work without them):

| Variable | Type | Value |
| --- | --- | --- |
| `PUBLIC_SITE_URL` | plain | `https://<your-project>.pages.dev` (or your custom domain) |
| `AUTH_SECRET` | **secret** | a long random hex string — run `openssl rand -hex 32` (or any 64-char random string) |
| `ADMIN_EMAIL` | plain | the email you'll use to sign in to `/hq` |
| `ADMIN_PASSWORD` | **secret** | a strong password for that account |
| `GOOGLE_CLIENT_ID` | plain | Google OAuth client ID (Step 4) |
| `GOOGLE_CLIENT_SECRET` | **secret** | Google OAuth client secret |
| `GOOGLE_REDIRECT_URI` | plain | `https://<your-project>.pages.dev/api/auth/google/callback` |
| `EMAIL_TRANSPORT` | plain | `http` (recommended) or `console` (emails just print to logs — fine for testing) |
| `EMAIL_FROM` / `EMAIL_FROM_NAME` | plain | sender address/name |
| `EMAIL_API_URL` / `EMAIL_API_KEY` | plain / **secret** | transactional email API (e.g. Resend) when `EMAIL_TRANSPORT=http` |

Apply to **Production**. Redeploy (or the next push) picks them up.

## Step 4 — Google "Continue with Google" (optional but recommended)

1. Go to [console.cloud.google.com/apis/credentials](https://console.cloud.google.com/apis/credentials)
   → **Create credentials → OAuth client ID → Web application**.
2. Under **Authorized redirect URIs** add **exactly**:
   - `https://<your-project>.pages.dev/api/auth/google/callback`
   - (local testing) `http://127.0.0.1:4321/api/auth/google/callback`
3. Copy the **Client ID** and **Client secret** into the env vars above.
   The URI must match character-for-character or Google rejects login with
   `redirect_uri_mismatch`.

## Step 5 — Custom domain (later)

Pages project → **Custom domains** → add e.g. `zenith.vip` (DNS managed by
Cloudflare → it handles the record automatically). Then update
`PUBLIC_SITE_URL`, `GOOGLE_REDIRECT_URI` (+ the Google Console URI), and
`astro.config.mjs` → `site` to the new domain and redeploy.

## Step 6 — What works on deploy, and what needs more setup

- ✅ Public site, products, changelog, FAQ, media, legal, community.
- ✅ Google login + email sending **once** the credentials above are set.
- ⚠️ **Account sign-in, the account area, the admin panel, and protected
   downloads need a database.** The current build ships with a dev-only
   JSON-file store; in production those pages return a clean "not set up yet"
   message until a real database (Cloudflare D1) is connected. See
   `README.md → Production backend` for the plan — this is the one remaining
   integration.

## Security settings worth enabling

- **Rate limiting**: dashboard → your domain → **Security → WAF → Rate limiting**
  (e.g. 20 requests/10s per IP on `/api/auth/*` and `/hq/*`) — the app already
  rate-limits internally, this adds a network-level cap.
- **Bot fight mode** / **Managed challenge** on the security level if you want.
- The admin panel is at `/hq` — keep it unlisted (it already is).
