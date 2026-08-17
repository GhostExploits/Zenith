/// <reference types="astro/client" />

interface ImportMetaEnv {
  readonly PUBLIC_SITE_URL?: string;
  readonly AUTH_SECRET?: string;
  readonly ADMIN_EMAIL?: string;
  readonly ADMIN_PASSWORD?: string;
  readonly DATABASE_PROVIDER?: string;
  readonly DATABASE_URL?: string;

  // Google OAuth (server-side only — the secret never reaches the browser)
  readonly GOOGLE_CLIENT_ID?: string;
  readonly GOOGLE_CLIENT_SECRET?: string;
  readonly GOOGLE_REDIRECT_URI?: string;

  // Email delivery
  //   console = print to the server log (development)
  //   smtp    = SMTP via nodemailer (development; not available on Cloudflare)
  //   http    = generic transactional HTTP API (Resend-compatible POST /emails)
  readonly EMAIL_TRANSPORT?: string;
  readonly EMAIL_FROM?: string;
  readonly EMAIL_FROM_NAME?: string;
  readonly SMTP_HOST?: string;
  readonly SMTP_PORT?: string;
  readonly SMTP_USERNAME?: string;
  readonly SMTP_PASSWORD?: string;
  readonly EMAIL_API_URL?: string;
  readonly EMAIL_API_KEY?: string;

  // Payments (Paddle — server-side only; the secret never reaches the browser)
  readonly PAYMENT_PROVIDER?: string;
  readonly PADDLE_API_KEY?: string;
  readonly PADDLE_WEBHOOK_SECRET?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
