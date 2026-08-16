import type { LegalDoc } from '../lib/types';

/**
 * Legal documents.
 *
 * These are clearly-marked PLACEHOLDERS. The owner must replace them with
 * final policies written with legal advice before production use. Nothing
 * here is legal advice and no claims are asserted as binding.
 */
export const legalDocs: LegalDoc[] = [
  {
    slug: 'terms',
    title: 'Terms of Service',
    updated: '2026-08-01',
    intro:
      'PLACEHOLDER — final Terms of Service have not been provided. This document will be replaced before launch and is not legally binding in its current form.',
    sections: [
      { heading: '1. Service', body: 'Zenith provides software products, including the Zenith Minecraft client. Use of the service is subject to these (to-be-finalized) terms.' },
      { heading: '2. Accounts', body: 'You are responsible for keeping your account credentials secure and for all activity under your account. Accounts may be suspended for abuse or policy violations.' },
      { heading: '3. Entitlements', body: 'Purchases and subscriptions grant entitlements to products. Entitlements are tied to your account and are not transferable unless stated otherwise.' },
      { heading: '4. Acceptable use', body: 'See the Rules page. Use of the software must comply with all applicable laws and with third-party platform rules.' },
      { heading: '5. Termination', body: 'We may terminate or suspend access where required by law or where the terms are materially breached.' },
    ],
  },
  {
    slug: 'privacy',
    title: 'Privacy Policy',
    updated: '2026-08-01',
    intro:
      'PLACEHOLDER — final Privacy Policy has not been provided. This document will be replaced before launch and is not legally binding in its current form.',
    sections: [
      { heading: '1. Data we collect', body: 'Account data (email, name), entitlement records, and technical logs needed to operate the service. Payment details are handled by the (future) payment provider and never stored by us.' },
      { heading: '2. How we use data', body: 'To provide and secure the service, process entitlements, and communicate service-relevant updates.' },
      { heading: '3. Sharing', body: 'We do not sell personal data. Data is shared only with processors required to operate the service (hosting, email, payments).' },
      { heading: '4. Your rights', body: 'Depending on your jurisdiction, you may have rights to access, correct, or delete your data. Contact support to exercise them.' },
      { heading: '5. Cookies', body: 'We use essential cookies for authentication. Analytics cookies will only be added with your consent.' },
    ],
  },
  {
    slug: 'refunds',
    title: 'Refund Policy',
    updated: '2026-08-01',
    intro:
      'PLACEHOLDER — final Refund Policy has not been provided. This document will be replaced before launch and is not legally binding in its current form.',
    sections: [
      { heading: '1. Subscriptions', body: 'Subscriptions can be canceled at any time and remain active until the end of the current billing period. Refunds for the current period are evaluated on request.' },
      { heading: '2. Lifetime purchases', body: 'One-time purchases may be refundable within a review window if the product is unusable for you. Each request is reviewed individually.' },
      { heading: '3. How to request a refund', body: 'Open a support ticket from the Support page within the applicable window and include your account email and purchase reference.' },
    ],
  },
  {
    slug: 'rules',
    title: 'Rules & Acceptable Use',
    updated: '2026-08-01',
    intro:
      'PLACEHOLDER — final Rules have not been provided. This document will be replaced before launch and is not legally binding in its current form.',
    sections: [
      { heading: '1. Fair use', body: 'Use the software responsibly and in accordance with the terms of any server or platform you play on.' },
      { heading: '2. Sharing', body: 'Do not share, resell, or publicly redistribute the client or its release files.' },
      { heading: '3. Accounts', body: 'Do not share accounts, attempt to bypass entitlements, or interfere with the service.' },
      { heading: '4. Enforcement', body: 'Violations may result in warnings, suspension, or revocation of access depending on severity.' },
    ],
  },
];

export function getLegalDoc(slug: string): LegalDoc | undefined {
  return legalDocs.find((d) => d.slug === slug);
}
