/**
 * Central site configuration.
 *
 * Everything brand- or link-related lives here (or in the DB-backed site
 * content for values the admin panel can edit). Never scatter URLs across
 * components — import from this module.
 *
 * Placeholders: values wrapped in [BRACKETS] are intentional placeholders to
 * be replaced when real links/assets exist. Do not invent production links.
 */

export const site = {
  name: 'Zenith',
  tagline: 'Precision tools. Competitive advantage.',
  description:
    'Zenith is a premium Minecraft client built for performance, precision, and control. Fine-tune every module, keep the game smooth, and play with an edge.',
  url: 'https://zenithv2.pages.dev',
  domain: 'zenithv2.pages.dev',

  // The official logo asset (white wordmark, transparent background).
  logo: {
    src: '/logo/zenith-logo.webp',
    srcFallback: '/logo/zenith-logo.png',
    srcSmall: '/logo/zenith-logo-600.webp',
    srcSmallFallback: '/logo/zenith-logo-600.png',
    alt: 'Zenith logo',
    width: 1400,
    height: 583, // 1400 * 809/1944
  },

  // --- Links (placeholders until real destinations exist) ---
  links: {
    discord: '[DISCORD_LINK]',
    twitter: '[TWITTER_LINK]',
    youtube: '[YOUTUBE_LINK]',
    github: '[GITHUB_LINK]',
    support: '[SUPPORT_LINK]',
  },

  nav: {
    primary: [
      { label: 'Home', href: '/' },
      { label: 'Products', href: '/products' },
      { label: 'Features', href: '/features' },
      { label: 'Changelog', href: '/changelog' },
      { label: 'Support', href: '/support' },
      { label: 'Community', href: '/community' },
      { label: 'Credits', href: '/credits' },
    ],
    legal: [
      { label: 'Terms of Service', href: '/legal/terms' },
      { label: 'Privacy Policy', href: '/legal/privacy' },
      { label: 'Refund Policy', href: '/legal/refunds' },
      { label: 'Rules', href: '/legal/rules' },
    ],
  },

  // Default CTA labels (editable via admin → Site Content).
  cta: {
    primary: 'Get Zenith',
    secondary: 'Explore Features',
    signIn: 'Sign in',
    account: 'Account',
  },
} as const;

export type SiteConfig = typeof site;
