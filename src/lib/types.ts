/**
 * Zenith domain model — single source of truth for the entities used across
 * the public site, account portal, and admin panel.
 */

// ---------------------------------------------------------------------------
// Catalog (editable content — eventually managed from the admin panel)
// ---------------------------------------------------------------------------

export type Availability = 'available' | 'coming-soon' | 'beta' | 'unavailable';
export type ReleaseChannel = 'stable' | 'beta' | 'dev';
export type BillingInterval = 'month' | 'year' | 'once';

export interface Plan {
  id: string;
  productId: string;
  name: string;
  /** Price in minor units (cents). null = TBD. */
  priceCents: number | null;
  currency: string;
  interval: BillingInterval;
  description: string;
  features: string[];
  active: boolean;
  highlighted: boolean;
  /**
   * What kind of license a verified purchase of this plan grants:
   *   permanent            → a license that never expires (e.g. lifetime)
   *   subscription-period  → a license tied to the active subscription period
   */
  licenseMode: 'permanent' | 'subscription-period';
  /**
   * License tier granted by this plan. Must be one of the Zenith client's
   * tiers (BRONZE/SILVER/GOLD/DIAMOND) — the client gates modules on it and
   * rejects unknown tiers by treating them as SILVER.
   */
  tier: 'bronze' | 'silver' | 'gold' | 'diamond';
}

export interface ProductFeature {
  id: string;
  name: string;
  description: string;
  icon: string;
  category: string;
}

export interface Product {
  id: string;
  name: string;
  slug: string;
  tagline: string;
  shortDescription: string;
  longDescription: string;
  /** Icon/logo asset path under /public. */
  icon: string;
  screenshots: string[];
  features: ProductFeature[];
  minecraftVersions: string[];
  platforms: string[];
  channel: ReleaseChannel;
  currentVersion: string;
  availability: Availability;
  featured: boolean;
  purchaseType: 'subscription' | 'permanent' | 'both' | 'free';
  planIds: string[];
  status: 'planning' | 'beta' | 'released' | 'deprecated';
  downloadEnabled: boolean;
  /** Free-form metadata (e.g. system requirements) shown on the product page. */
  specs: { label: string; value: string }[];
  faqIds: string[];
}

export interface ChangelogSection {
  title: string;
  items: string[];
}

export interface Release {
  id: string;
  productId: string;
  version: string;
  title: string;
  /** ISO date. */
  date: string;
  channel: ReleaseChannel;
  featured: boolean;
  published: boolean;
  scheduledFor?: string;
  summary: string;
  sections: ChangelogSection[];
  minecraftVersions: string[];
  platforms: string[];
  asset?: {
    filename: string;
    /** Bytes. */
    sizeBytes: number;
    sha256: string;
  };
  requiresEntitlement: boolean;
}

export interface FaqEntry {
  id: string;
  category: string;
  question: string;
  answer: string;
  published: boolean;
}

export interface FeatureCategory {
  id: string;
  name: string;
  description: string;
  icon: string;
}

export interface MediaItem {
  id: string;
  src: string;
  alt: string;
  kind: 'screenshot' | 'ui' | 'video';
  productId?: string;
  caption?: string;
}

export interface Announcement {
  id: string;
  title: string;
  body: string;
  date: string;
  published: boolean;
  priority: 'low' | 'normal' | 'high';
}

export interface LegalSection {
  heading: string;
  body: string;
}

export interface LegalDoc {
  slug: string;
  title: string;
  updated: string;
  intro: string;
  sections: LegalSection[];
}

// ---------------------------------------------------------------------------
// Accounts, entitlements, commerce
// ---------------------------------------------------------------------------

export type Role = 'user' | 'moderator' | 'support' | 'admin' | 'owner';

export interface User {
  id: string;
  email: string;
  displayName: string;
  /** PBKDF2 hash; empty string means the account has no password (Google-only). */
  passwordHash: string;
  /** PBKDF2 params embedded so the scheme can evolve. */
  passwordScheme: 'pbkdf2-sha256';
  salt: string;
  iterations: number;
  /** Google OIDC subject ID, present when the account is linked to Google. */
  googleId?: string;
  /** Google profile picture (used for the account avatar). */
  avatarUrl?: string;
  /** Payment provider customer id (cached after first checkout). */
  providerCustomerId?: string;
  role: Role;
  emailVerified: boolean;
  emailVerifiedAt?: string;
  /** Set while an email change awaits verification of the new address. */
  pendingEmail?: string;
  suspended: boolean;
  createdAt: string;
  updatedAt: string;
  lastLoginAt?: string;
}

export interface Session {
  id: string;
  userId: string;
  createdAt: string;
  expiresAt: string;
  ip?: string;
  userAgent?: string;
}

export interface Purchase {
  id: string;
  userId: string;
  productId: string;
  planId: string;
  amountCents: number;
  currency: string;
  status: 'pending' | 'paid' | 'refunded' | 'failed';
  provider: string;
  providerRef?: string;
  createdAt: string;
  paidAt?: string;
  refundedAt?: string;
  /** License granted for this purchase (one-time plans) or its subscription. */
  licenseId?: string;
}

export interface License {
  id: string;
  /** Public license key, e.g. ZEN-XXXX-XXXX-XXXX. */
  key: string;
  /**
   * Client-facing license identifier embedded in the signed entitlement
   * payload (UUID). The Zenith client parses it from the payload.
   */
  licenseId: string;
  userId: string;
  productId: string;
  planId: string;
  purchaseId?: string;
  subscriptionId?: string;
  kind: 'permanent' | 'subscription';
  /** unused = admin-issued, not yet attached to an entitlement flow. */
  status: 'unused' | 'active' | 'expired' | 'revoked' | 'suspended';
  /**
   * Client tier. Must be one of BRONZE/SILVER/GOLD/DIAMOND (the Zenith
   * client's tier set). The client gates module access on this value.
   */
  tier: 'BRONZE' | 'SILVER' | 'GOLD' | 'DIAMOND';
  /** Recipient label embedded in the signed payload (the account email). */
  recipient: string;
  issuedAt: string;
  /** Absent for permanent licenses. */
  expiresAt?: string;
  activatedAt?: string;
  revokedAt?: string;
  notes?: string;
  /**
   * Ed25519 signature over the canonical entitlement payload (see
   * src/lib/server/authority.ts). The Zenith client verifies this locally
   * with the public key embedded in the client — a license without a valid
   * signature never unlocks the client.
   */
  signature?: string;
  /** Machine fingerprint the license is bound to (max 1 device). */
  deviceId?: string;
  boundAt?: string;
  transferCount: number;
  lastSeenAt?: string;
  clientVersion?: string;
  /** Record of activation/use events (when, from where). */
  activationHistory: { at: string; ip?: string; hwid?: string }[];
}

export interface Notification {
  id: string;
  type: 'purchase' | 'payment' | 'license' | 'subscription' | 'refund' | 'user' | 'system' | 'download';
  title: string;
  message: string;
  createdAt: string;
  read: boolean;
}

export type SubscriptionStatus = 'active' | 'past_due' | 'canceled' | 'expired';

export interface Subscription {
  id: string;
  userId: string;
  productId: string;
  planId: string;
  status: SubscriptionStatus;
  currentPeriodEnd: string;
  cancelAtPeriodEnd: boolean;
  provider: string;
  providerRef?: string;
  createdAt: string;
}

export interface AccountActivity {
  id: string;
  userId: string;
  type: 'signin' | 'signout' | 'signup' | 'password_change' | 'download' | 'purchase' | 'subscription_change' | 'settings_change';
  message: string;
  createdAt: string;
  ip?: string;
}

export interface AuditEntry {
  id: string;
  actorId: string;
  actorEmail: string;
  action: string;
  resource: string;
  details?: string;
  createdAt: string;
  ip?: string;
}

/** Site-content overrides managed from the admin panel (stored in the DB). */
export interface SiteContent {
  heroTitle: string;
  heroSubtitle: string;
  heroCtaPrimary: string;
  heroCtaSecondary: string;
  discordUrl: string;
  supportUrl: string;
  announcementBanner: string;
  announcementBannerActive: boolean;
}

// ---------------------------------------------------------------------------
// Database document
// ---------------------------------------------------------------------------

export interface DbDocument {
  schemaVersion: 2;
  seededAt: string | null;
  content: SiteContent;
  users: User[];
  sessions: Session[];
  purchases: Purchase[];
  subscriptions: Subscription[];
  licenses: License[];
  notifications: Notification[];
  activity: AccountActivity[];
  audit: AuditEntry[];
  /** Admin-managed catalog rows (products/plans/releases/faqs/announcements). */
  products: Product[];
  plans: Plan[];
  releases: Release[];
  faqs: FaqEntry[];
  announcements: Announcement[];
  /** One-time password-reset / email-verification tokens. */
  tokens: {
    id: string;
    userId: string;
    kind: 'verify-email' | 'reset-password';
    token: string;
    expiresAt: string;
    usedAt?: string;
    /** For verify-email tokens: the address being verified (email change). */
    email?: string;
    createdAt: string;
  }[];
  /** In-device counters for rate limiting (dev store only). */
  counters: Record<string, number[]>;
}
