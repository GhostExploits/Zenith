import type { FaqEntry } from '../lib/types';

/** FAQ catalog — data-driven so entries can be edited from the admin panel. */
export const faqs: FaqEntry[] = [
  {
    id: 'faq-install-1',
    category: 'Getting Started',
    question: 'How do I install Zenith V2?',
    answer:
      'Once you have an active entitlement, download the release JAR from the Downloads section of your account, add it to your launcher of choice (MultiMC, Prism Launcher, or the official launcher), and start it with the Java version listed on the product page. Setup instructions are also pinned in our Discord.',
    published: true,
  },
  {
    id: 'faq-versions-1',
    category: 'Getting Started',
    question: 'Which Minecraft versions does Zenith V2 support?',
    answer:
      'Zenith V2 currently supports 1.8.9, 1.12.2, 1.16.5, and 1.21.x. Supported versions are listed per release in the changelog and may grow over time.',
    published: true,
  },
  {
    id: 'faq-os-1',
    category: 'Getting Started',
    question: 'Which operating systems are supported?',
    answer: 'Windows 10/11, macOS (Intel and Apple Silicon), and Linux are supported. See the product page for hardware notes.',
    published: true,
  },
  {
    id: 'faq-billing-1',
    category: 'Purchases & Billing',
    question: 'How do purchases work?',
    answer:
      'Zenith V2 is available as a monthly subscription, a yearly subscription, or a one-time lifetime purchase. Subscriptions renew automatically; the lifetime purchase is a single payment for a permanent entitlement.',
    published: true,
  },
  {
    id: 'faq-billing-2',
    category: 'Purchases & Billing',
    question: 'What payment methods are accepted?',
    answer:
      'Payment processing is not connected yet — this is one of the first integrations planned. Until then, purchases cannot be completed through the site. Check the announcement banner or Discord for the current status.',
    published: true,
  },
  {
    id: 'faq-sub-1',
    category: 'Subscriptions',
    question: 'How do I cancel my subscription?',
    answer:
      'You can cancel from Account → Subscriptions at any time. Your access continues until the end of the current billing period. Cancellation takes effect at the next renewal date.',
    published: true,
  },
  {
    id: 'faq-sub-2',
    category: 'Subscriptions',
    question: 'What happens when my subscription expires?',
    answer:
      'Your entitlement becomes inactive and protected downloads are disabled. Your account and any lifetime entitlements remain intact.',
    published: true,
  },
  {
    id: 'faq-download-1',
    category: 'Downloads & Updates',
    question: 'Where do I download Zenith V2?',
    answer:
      'Releases are listed on the product page and in the Changelog. Downloads are protected: you must be signed in and hold an active entitlement for the product to download a release.',
    published: true,
  },
  {
    id: 'faq-download-2',
    category: 'Downloads & Updates',
    question: 'How do updates work?',
    answer:
      'Updates are published as new releases in the changelog. With an active entitlement you can download the latest release at any time. Your entitlements are tied to your account, not to a specific machine.',
    published: true,
  },
  {
    id: 'faq-account-1',
    category: 'Accounts & Security',
    question: 'I forgot my password. How do I reset it?',
    answer: 'Use the "Forgot password" link on the sign-in page. A reset link will be emailed to the address on your account.',
    published: true,
  },
  {
    id: 'faq-account-2',
    category: 'Accounts & Security',
    question: 'Can I use my account on multiple computers?',
    answer: 'Yes. Your account is the source of truth for entitlements; sign in on any supported machine and download your releases.',
    published: true,
  },
  {
    id: 'faq-account-3',
    category: 'Accounts & Security',
    question: 'How do I keep my account secure?',
    answer:
      'Use a strong, unique password and enable email verification. We never store passwords in plaintext and never ask for your password outside of the sign-in page.',
    published: true,
  },
  {
    id: 'faq-support-1',
    category: 'Troubleshooting',
    question: 'The client crashes on startup. What should I do?',
    answer:
      'Make sure you are using the Java version listed for your Minecraft version, check that your GPU drivers are current, and try the performance preset. If it still crashes, attach your latest log from the client folder when opening a support ticket.',
    published: true,
  },
  {
    id: 'faq-support-2',
    category: 'Troubleshooting',
    question: 'The game runs slowly with the client installed.',
    answer:
      'Try the built-in performance modes first, reduce HUD elements, and lower rendering-related settings. If the issue persists, open a support ticket with your hardware info and FPS figures.',
    published: true,
  },
  {
    id: 'faq-refund-1',
    category: 'Refunds',
    question: 'What is the refund policy?',
    answer:
      'See the Refund Policy page. In short: refunds for subscriptions are handled per the published policy, and lifetime purchases are reviewed on a case-by-case basis within the stated window.',
    published: true,
  },
  {
    id: 'faq-legal-1',
    category: 'Legal',
    question: 'Is Zenith affiliated with Minecraft or Mojang?',
    answer:
      'No. Zenith is an independent project and is not affiliated with, endorsed by, or connected to Mojang Studios or Microsoft. Minecraft is a trademark of Mojang Studios.',
    published: true,
  },
];

export function faqsByCategory(): { category: string; items: FaqEntry[] }[] {
  const map = new Map<string, FaqEntry[]>();
  for (const f of faqs) {
    if (!f.published) continue;
    if (!map.has(f.category)) map.set(f.category, []);
    map.get(f.category)!.push(f);
  }
  return [...map.entries()].map(([category, items]) => ({ category, items }));
}
