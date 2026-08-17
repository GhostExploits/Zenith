# Customizing Zenith — owner's guide

This project is a normal code repository. Everything you see on the site lives in
a few well-marked places, listed below from "you will edit these the most" to
"leave these alone unless you know what you're doing".

> **Not a developer?** The safest way to change text, prices, releases, FAQs and
> announcements is the **admin panel** (see below) — it edits the database, not
> the code. Use this guide for everything else.

---

## 1. Run the site locally (before making changes)

You need [Node.js](https://nodejs.org) 20+ installed.

```bash
npm install     # first time only
npm run dev     # starts the dev server at http://127.0.0.1:4321
```

While the dev server is running, every save you make to a file instantly
appears in the browser (just refresh). There is also a `.env` file in the root —
copy `.env.example` to `.env` first if it doesn't exist (`npm run seed` will
then create a demo database with an admin account).

---

## 2. Add screenshots / images (what you said you'd do next)

1. Put the image file inside the `public/` folder — for example `public/screenshots/overview.webp` (`.png` works too).
2. Reference it from a page or content file with a leading slash:
   ```astro
   <img src="/screenshots/overview.webp" alt="Overview screenshot" />
   ```
   - **Product screenshots** — `src/content/products.ts` has a `screenshots: []` field per product; add paths there and they can be shown by any component that reads it.
   - **Homepage hero / feature images** — `src/pages/index.astro` is the homepage file; add your `<img>` or `<picture>` right where you want it.
3. Prefer `.webp` for photos/screenshots (much smaller). If you only have `.png`, just use it.

> Tip: keep images in `public/` and reference them with a leading `/`. Files in
> `src/` are treated as code and can't be hot-linked the same way.

## 3. Logo

- The official logo lives in `public/logo/` (`zenith-logo.png` + `.webp` + smaller `-600` variants).
- To replace it: drop your new file(s) over these names (keep the same name).
  Also update the `logo` block in `src/config/site.ts` if you change dimensions.
- **Known quirk:** the current artwork has the "V2" badge far to the right, so
  the CSS nudges the image so the *wordmark* sits centered
  (`.hero-logo__media { transform: translateX(12.71%) }` in
  `src/styles/global.css`). If you re-cut the logo with centered content,
  delete that rule.

## 4. Text & copy (site-wide content)

| What | Where |
| --- | --- |
| Site name, tagline, description, nav links, footer links, social URLs | `src/config/site.ts` |
| Hero title/subtitle, CTA labels, Discord link, announcement banner | Admin → **Site Content** (stored in the DB) |
| Product names, descriptions, features, MC versions | `src/content/products.ts` |
| Plans / pricing (names, prices, intervals) | `src/content/plans.ts` |
| Changelog / releases (initial seed) | `src/content/changelog.ts` |
| FAQ entries (initial seed) | `src/content/faq.ts` |
| Legal pages (Terms, Privacy, Refunds, Rules) | `src/pages/legal/` |

Pages themselves (structure/layout of each route) are in `src/pages/` — e.g.
`index.astro` is the homepage, `products/index.astro` the products page.

## 5. Design system (colors, fonts, spacing)

Everything visual is controlled by one file: **`src/styles/global.css`**.

At the top you'll find the design tokens — the "ingredients":

```css
:root {
  --bg: #0a0a0d;            /* page background */
  --bg-raised: #131318;     /* card surface */
  --border: rgba(255,255,255,0.07);
  --text: #f2f2f6;
  --text-dim: #a4a4b2;
  --accent: #ffffff;        /* the accent color (currently monochrome) */
  --font-display: 'Space Grotesk Variable', ...;
  --font-mono: 'JetBrains Mono Variable', ...;
}
```

Change a value there and the whole site updates. Accent = white currently;
set `--accent` to your brand color if you want it back to gold/anything else.

## 6. The admin panel (hidden on purpose)

- **Path:** `https://<your-site>/hq` (kept out of robots.txt, the sitemap, and
  all public links so scanners can't find it).
- Sign in with an admin account, then visit `/hq`. The first admin is created
  from `ADMIN_EMAIL` / `ADMIN_PASSWORD` in your `.env` (dev) or as Cloudflare
  secrets (production).
- From there you can manage orders, licenses, users, products, plans,
  releases (including uploading the actual download file), FAQs,
  announcements, site content, and notifications — plus read the audit log.
  All actions have confirm dialogs and audit trails.
- Plans are the four tiers **Bronze / Silver / Diamond / Platinum** (editable
  here). Each plan's *license mode* controls what a purchase grants:
  **Subscription-period** (license valid while subscribed) or **Permanent**
  (never expires — used by Platinum).

## 7. What NOT to touch (unless you mean it)

- `src/lib/server/**` — auth, sessions, entitlements, storage, API guards.
- `src/pages/api/**` — server endpoints (they're what makes login/downloads real).
- `src/layouts/`, `src/middleware.ts`, `astro.config.mjs`, `wrangler.toml`,
  `public/robots.txt` — infrastructure.

## 8. After editing, publish

See **DEPLOY.md** in the repo root for the full Cloudflare publish walkthrough.
Short version: push your changes to GitHub → Cloudflare Pages rebuilds
automatically.

---

*Full deployment & configuration instructions: [`DEPLOY.md`](DEPLOY.md).*
