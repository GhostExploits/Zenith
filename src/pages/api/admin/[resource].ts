import type { APIRoute } from 'astro';
import { ApiError, fail, json, ok, readPayload, requireAdmin, requireSameOrigin } from '../../../lib/server/api';
import { canManage, ROLE_RANK } from '../../../lib/server/auth';
import { logAudit } from '../../../lib/server/activity';
import { clientKey, isRateLimited, recordHit } from '../../../lib/server/rateLimit';
import {
  buildManualLicense,
  extendLicense,
  reactivateLicense,
  resetLicenseDevice,
  revokeLicense,
  setLicenseTier,
  suspendLicense,
} from '../../../lib/server/licenses';
import { notify } from '../../../lib/server/notifications';
import { putStoredAsset } from '../../../lib/server/storage';

function toHex(buf: ArrayBuffer | Uint8Array): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Admin CRUD API.
 *
 * Every operation here requires an authenticated session whose role is
 * admin/owner (checked server-side), a same-origin request (CSRF), and is
 * recorded in the audit log. The browser is never trusted with roles.
 *
 * Resources: products | plans | releases | faqs | announcements | users | content
 */
const RESOURCES = ['products', 'plans', 'releases', 'faqs', 'announcements', 'users', 'content', 'licenses', 'notifications'] as const;

function cleanString(value: unknown, max = 500): string {
  return String(value ?? '').trim().slice(0, max);
}

function cleanBool(value: unknown): boolean {
  return value === 'true' || value === true || value === '1';
}

function cleanArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((v) => String(v).trim().slice(0, 200)).filter(Boolean);
  if (typeof value === 'string') {
    // Accept comma-separated values from form inputs.
    return value.split(',').map((v) => v.trim()).filter(Boolean).slice(0, 50);
  }
  return [];
}

export const POST: APIRoute = async (ctx) => {
  try {
    requireSameOrigin(ctx);
    if (isRateLimited(`admin:${clientKey(ctx.request)}`)) {
      recordHit(`admin:${clientKey(ctx.request)}`);
      throw new ApiError(429, 'rate_limited', 'Too many requests. Please wait a few minutes.');
    }
    recordHit(`admin:${clientKey(ctx.request)}`);
    const { user, store } = await requireAdmin(ctx);
    const resource = ctx.params.resource ?? '';
    if (!RESOURCES.includes(resource as never)) throw new ApiError(404, 'unknown_resource', 'Unknown admin resource.');

    const payload = await readPayload(ctx);
    const action = cleanString(payload.action, 20);
    const id = cleanString(payload.id, 80);
    const data = (payload.data as Record<string, unknown> | undefined) ?? payload;
    const db = store.db();

    // ---- products ----------------------------------------------------------
    if (resource === 'products') {
      if (action === 'create' || action === 'update') {
        const name = cleanString(data.name, 80);
        const slug = cleanString(data.slug, 80).toLowerCase().replace(/[^a-z0-9-]/g, '-');
        if (!name || !slug) throw new ApiError(400, 'validation', 'Name and slug are required.');
        if (db.products.some((p) => p.slug === slug && p.id !== id)) {
          throw new ApiError(409, 'duplicate', 'Another product already uses that slug.');
        }
        const existing = action === 'update' ? db.products.find((p) => p.id === id) : undefined;
        if (action === 'update' && !existing) throw new ApiError(404, 'not_found', 'Product not found.');

        const product = {
          id: existing?.id ?? `product-${crypto.randomUUID()}`,
          name,
          slug,
          tagline: cleanString(data.tagline, 160),
          shortDescription: cleanString(data.shortDescription, 300),
          longDescription: cleanString(data.longDescription, 2000),
          icon: cleanString(data.icon, 300) || '/logo/zenith-logo-600.webp',
          screenshots: cleanArray(data.screenshots),
          features: Array.isArray(data.features)
            ? (data.features as { name?: unknown; description?: unknown; icon?: unknown; category?: unknown }[]).map((f) => ({
                id: `f-${crypto.randomUUID()}`,
                name: cleanString(f.name, 80),
                description: cleanString(f.description, 300),
                icon: cleanString(f.icon, 40) || 'spark',
                category: cleanString(f.category, 40) || 'Utility',
              }))
            : existing?.features ?? [],
          minecraftVersions: cleanArray(data.minecraftVersions),
          platforms: cleanArray(data.platforms),
          channel: (cleanString(data.channel, 10) as 'stable' | 'beta' | 'dev') || 'beta',
          currentVersion: cleanString(data.currentVersion, 30) || '0.0.0',
          availability: (cleanString(data.availability, 20) as 'available' | 'coming-soon' | 'unavailable') || 'coming-soon',
          featured: cleanBool(data.featured),
          purchaseType: (cleanString(data.purchaseType, 20) as 'subscription' | 'permanent' | 'both' | 'free') || 'subscription',
          planIds: cleanArray(data.planIds),
          status: (cleanString(data.status, 20) as 'planning' | 'beta' | 'released' | 'deprecated') || 'planning',
          downloadEnabled: cleanBool(data.downloadEnabled),
          specs: existing?.specs ?? [],
          faqIds: cleanArray(data.faqIds),
        };
        await store.mutate((d) => {
          if (action === 'create') d.products.push(product);
          else d.products = d.products.map((p) => (p.id === id ? product : p));
        });
        await logAudit(store, user, action, 'product', `${name} (${slug})`, ctx.request);
        return json({ ok: true, id: product.id });
      }
      if (action === 'delete') {
        await store.mutate((d) => { d.products = d.products.filter((p) => p.id !== id); });
        await logAudit(store, user, 'delete', 'product', id, ctx.request);
        return ok();
      }
    }

    // ---- plans -------------------------------------------------------------
    if (resource === 'plans') {
      if (action === 'create' || action === 'update') {
        const productId = cleanString(data.productId, 80);
        const name = cleanString(data.name, 80);
        const interval = cleanString(data.interval, 10);
        const priceCentsRaw = Number(data.priceCents ?? data.price);
        if (!productId || !name || !['month', 'year', 'once'].includes(interval)) {
          throw new ApiError(400, 'validation', 'Product, plan name, and a valid billing interval are required.');
        }
        if (!Number.isFinite(priceCentsRaw) || priceCentsRaw < 0) {
          throw new ApiError(400, 'validation', 'Price must be a positive number.');
        }
        const existing = action === 'update' ? db.plans.find((p) => p.id === id) : undefined;
        const tierRaw = cleanString(data.tier, 10).toLowerCase();
        if (!['bronze', 'silver', 'gold', 'diamond'].includes(tierRaw)) {
          throw new ApiError(400, 'validation', 'Tier must be one of bronze, silver, gold, or diamond.');
        }
        const plan = {
          id: existing?.id ?? `plan-${crypto.randomUUID()}`,
          productId,
          name,
          priceCents: Math.round(priceCentsRaw),
          currency: cleanString(data.currency, 3) || 'USD',
          interval: interval as 'month' | 'year' | 'once',
          description: cleanString(data.description, 300),
          features: cleanArray(data.features),
          active: cleanBool(data.active),
          highlighted: cleanBool(data.highlighted),
          licenseMode: (cleanString(data.licenseMode, 20) as 'permanent' | 'subscription-period') || 'subscription-period',
          tier: tierRaw as 'bronze' | 'silver' | 'gold' | 'diamond',
        };
        await store.mutate((d) => {
          if (action === 'create') d.plans.push(plan);
          else d.plans = d.plans.map((p) => (p.id === id ? plan : p));
        });
        await logAudit(store, user, action, 'plan', `${productId}/${name}`, ctx.request);
        return json({ ok: true, id: plan.id });
      }
      if (action === 'delete') {
        await store.mutate((d) => { d.plans = d.plans.filter((p) => p.id !== id); });
        await logAudit(store, user, 'delete', 'plan', id, ctx.request);
        return ok();
      }
    }

    // ---- releases ----------------------------------------------------------
    if (resource === 'releases') {
      if (action === 'create' || action === 'update') {
        const productId = cleanString(data.productId, 80);
        const version = cleanString(data.version, 30);
        const title = cleanString(data.title, 120);
        if (!productId || !version || !title) throw new ApiError(400, 'validation', 'Product, version, and title are required.');
        const existing = action === 'update' ? db.releases.find((r) => r.id === id) : undefined;
        const releaseId = existing?.id ?? `release-${crypto.randomUUID()}`;
        // Optional attached file: when present (and R2 is bound), upload it to
        // private storage and derive the asset metadata server-side.
        let asset = {
          filename: cleanString(data.assetFilename, 120) || `${version}.jar`,
          sizeBytes: Number(data.assetSize) || 0,
          sha256: cleanString(data.assetSha256, 100) || '[RELEASE_SHA256]',
        };
        const assetFile = data.assetFile;
        if (assetFile instanceof File && assetFile.size > 0) {
          const filename = assetFile.name.replace(/[^a-zA-Z0-9._-]/g, '_') || asset.filename;
          const bytes = new Uint8Array(await assetFile.arrayBuffer());
          const sha256 = toHex(await crypto.subtle.digest('SHA-256', bytes));
          try {
            await putStoredAsset(releaseId, filename, bytes, assetFile.type || 'application/octet-stream');
          } catch {
            throw new ApiError(503, 'storage_not_configured', 'Release storage (R2) is not configured for file uploads.');
          }
          asset = { filename, sizeBytes: bytes.byteLength, sha256 };
        }
        let sections: { title: string; items: string[] }[] = [];
        if (Array.isArray(data.sections)) {
          sections = (data.sections as { title?: unknown; items?: unknown }[])
            .map((s) => ({ title: cleanString(s.title, 60), items: cleanArray(s.items) }))
            .filter((s) => s.title);
        } else if (typeof data.sections === 'string' && data.sections.trim()) {
          // Textarea format: one section per line, "Title|item1, item2"
          sections = data.sections
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter(Boolean)
            .map((line) => {
              const [title, items] = line.split('|');
              return { title: (title ?? '').trim().slice(0, 60), items: cleanArray(items ?? '') };
            })
            .filter((s) => s.title);
        } else {
          sections = existing?.sections ?? [];
        }
        const release = {
          id: releaseId,
          productId,
          version,
          title,
          date: cleanString(data.date, 10) || new Date().toISOString().slice(0, 10),
          channel: (cleanString(data.channel, 10) as 'stable' | 'beta' | 'dev') || 'beta',
          featured: cleanBool(data.featured),
          published: cleanBool(data.published),
          scheduledFor: cleanString(data.scheduledFor, 30) || undefined,
          summary: cleanString(data.summary, 500),
          sections,
          minecraftVersions: cleanArray(data.minecraftVersions),
          platforms: cleanArray(data.platforms),
          asset,
          requiresEntitlement: cleanBool(data.requiresEntitlement),
        };
        await store.mutate((d) => {
          if (action === 'create') d.releases.push(release);
          else d.releases = d.releases.map((r) => (r.id === id ? release : r));
        });
        await logAudit(store, user, action, 'release', `${productId}/${version}`, ctx.request);
        return json({ ok: true, id: release.id });
      }
      if (action === 'delete') {
        await store.mutate((d) => { d.releases = d.releases.filter((r) => r.id !== id); });
        await logAudit(store, user, 'delete', 'release', id, ctx.request);
        return ok();
      }
    }

    // ---- faqs --------------------------------------------------------------
    if (resource === 'faqs') {
      if (action === 'create' || action === 'update') {
        const question = cleanString(data.question, 200);
        const answer = cleanString(data.answer, 3000);
        const category = cleanString(data.category, 60) || 'General';
        if (!question || !answer) throw new ApiError(400, 'validation', 'Question and answer are required.');
        const existing = action === 'update' ? db.faqs.find((f) => f.id === id) : undefined;
        const faq = {
          id: existing?.id ?? `faq-${crypto.randomUUID()}`,
          category,
          question,
          answer,
          published: cleanBool(data.published),
        };
        await store.mutate((d) => {
          if (action === 'create') d.faqs.push(faq);
          else d.faqs = d.faqs.map((f) => (f.id === id ? faq : f));
        });
        await logAudit(store, user, action, 'faq', question, ctx.request);
        return json({ ok: true, id: faq.id });
      }
      if (action === 'delete') {
        await store.mutate((d) => { d.faqs = d.faqs.filter((f) => f.id !== id); });
        await logAudit(store, user, 'delete', 'faq', id, ctx.request);
        return ok();
      }
    }

    // ---- announcements -----------------------------------------------------
    if (resource === 'announcements') {
      if (action === 'create' || action === 'update') {
        const title = cleanString(data.title, 160);
        const body = cleanString(data.body, 2000);
        if (!title || !body) throw new ApiError(400, 'validation', 'Title and body are required.');
        const existing = action === 'update' ? db.announcements.find((a) => a.id === id) : undefined;
        const announcement = {
          id: existing?.id ?? `ann-${crypto.randomUUID()}`,
          title,
          body,
          date: cleanString(data.date, 10) || new Date().toISOString().slice(0, 10),
          published: cleanBool(data.published),
          priority: (cleanString(data.priority, 10) as 'low' | 'normal' | 'high') || 'normal',
        };
        await store.mutate((d) => {
          if (action === 'create') d.announcements.push(announcement);
          else d.announcements = d.announcements.map((a) => (a.id === id ? announcement : a));
        });
        await logAudit(store, user, action, 'announcement', title, ctx.request);
        return json({ ok: true, id: announcement.id });
      }
      if (action === 'delete') {
        await store.mutate((d) => { d.announcements = d.announcements.filter((a) => a.id !== id); });
        await logAudit(store, user, 'delete', 'announcement', id, ctx.request);
        return ok();
      }
    }

    // ---- users (role & suspension management) ------------------------------
    if (resource === 'users') {
      const target = db.users.find((u) => u.id === id);
      if (!target) throw new ApiError(404, 'not_found', 'User not found.');
      if (target.id === user.id) throw new ApiError(400, 'self_edit', "You can't change your own role or status here.");

      if (action === 'update_role') {
        const newRole = cleanString(data.role, 20);
        if (!ROLE_RANK[newRole]) throw new ApiError(400, 'validation', 'Invalid role.');
        if (!canManage(user, newRole)) {
          throw new ApiError(403, 'forbidden', 'You cannot assign a role at or above your own.');
        }
        await store.mutate((d) => {
          const u = d.users.find((x) => x.id === id);
          if (u) u.role = newRole as typeof u.role;
        });
        await logAudit(store, user, 'update_role', 'user', `${target.email} → ${newRole}`, ctx.request);
        return ok();
      }
      if (action === 'update_status') {
        const suspended = cleanBool(data.suspended);
        await store.mutate((d) => {
          const u = d.users.find((x) => x.id === id);
          if (u) {
            u.suspended = suspended;
            if (suspended) d.sessions = d.sessions.filter((s) => s.userId !== id);
          }
        });
        await logAudit(store, user, suspended ? 'suspend' : 'unsuspend', 'user', target.email, ctx.request);
        return ok();
      }
      throw new ApiError(400, 'bad_action', 'Unknown user action.');
    }

    // ---- licenses ----------------------------------------------------------
    if (resource === 'licenses') {
      if (action === 'create') {
        const email = cleanString(data.email, 200).toLowerCase();
        const planId = cleanString(data.planId, 80);
        const target = db.users.find((u) => u.email === email);
        if (!target) throw new ApiError(404, 'user_not_found', 'No account has that email.');
        const plan = db.plans.find((p) => p.id === planId);
        if (!plan) throw new ApiError(404, 'plan_not_found', 'Plan not found.');
        const expiresAtRaw = cleanString(data.expiresAt, 30);
        // Build + sign the entitlement BEFORE the write (signing is async and
        // store.mutate callbacks are synchronous).
        const license = await buildManualLicense(db, target, plan, {
          expiresAt: expiresAtRaw ? new Date(expiresAtRaw).toISOString() : undefined,
          notes: cleanString(data.notes, 300) || undefined,
        });
        await store.mutate((d) => {
          d.licenses.push(license);
        });
        await notify(store, 'license', 'License issued', `${target.email} — ${plan.name} (${license.key}).`);
        await logAudit(store, user, 'create', 'license', `${target.email} — ${plan.name} (${license.key})`, ctx.request);
        return json({ ok: true, key: license.key });
      }
      const license = db.licenses.find((l) => l.id === id);
      if (!license) throw new ApiError(404, 'not_found', 'License not found.');
      if (action === 'revoke') {
        await store.mutate((d) => revokeLicense(d, id, 'Revoked from admin panel'));
        await notify(store, 'license', 'License revoked', `${license.key} (${license.tier}) was revoked by ${user.email}.`);
        await logAudit(store, user, 'revoke', 'license', license.key, ctx.request);
        return ok();
      }
      if (action === 'reactivate') {
        await store.mutate((d) => reactivateLicense(d, id));
        await logAudit(store, user, 'reactivate', 'license', license.key, ctx.request);
        return ok();
      }
      if (action === 'suspend') {
        await store.mutate((d) => suspendLicense(d, id));
        await logAudit(store, user, 'suspend', 'license', license.key, ctx.request);
        return ok();
      }
      if (action === 'extend') {
        const days = Math.round(Number(data.days));
        if (!Number.isFinite(days) || days <= 0) throw new ApiError(400, 'validation', 'Extension days must be a positive number.');
        const updated = await extendLicense(store, id, days);
        if (!updated) throw new ApiError(404, 'not_found', 'License not found.');
        await logAudit(store, user, 'extend', 'license', `${license.key} +${days}d`, ctx.request);
        return ok();
      }
      if (action === 'set_tier') {
        const updated = await setLicenseTier(store, id, cleanString(data.tier, 10));
        if (!updated) throw new ApiError(400, 'validation', 'Tier must be one of bronze, silver, gold, or diamond.');
        await notify(store, 'license', 'License tier changed', `${license.key} is now ${updated.tier}.`);
        await logAudit(store, user, 'set_tier', 'license', `${license.key} → ${updated.tier}`, ctx.request);
        return ok();
      }
      if (action === 'reset_device') {
        await store.mutate((d) => resetLicenseDevice(d, id));
        await notify(
          store,
          'license',
          'Device binding reset',
          `${license.key} was unbound from its device by ${user.email} — it can now be activated on another machine.`,
        );
        await logAudit(store, user, 'reset_device', 'license', license.key, ctx.request);
        return ok();
      }
      if (action === 'delete') {
        await store.mutate((d) => { d.licenses = d.licenses.filter((l) => l.id !== id); });
        await logAudit(store, user, 'delete', 'license', license.key, ctx.request);
        return ok();
      }
      throw new ApiError(400, 'bad_action', 'Unknown license action.');
    }

    // ---- notifications -----------------------------------------------------
    if (resource === 'notifications') {
      if (action === 'mark_read') {
        await store.mutate((d) => {
          if (id) {
            const n = d.notifications.find((x) => x.id === id);
            if (n) n.read = true;
          } else {
            d.notifications = d.notifications.map((n) => ({ ...n, read: true }));
          }
        });
        return ok();
      }
      if (action === 'clear') {
        await store.mutate((d) => { d.notifications = []; });
        return ok();
      }
      throw new ApiError(400, 'bad_action', 'Unknown notification action.');
    }

    // ---- site content ------------------------------------------------------
    if (resource === 'content') {
      const allowed: Record<string, string | boolean> = {};
      const stringFields = ['heroTitle', 'heroSubtitle', 'heroCtaPrimary', 'heroCtaSecondary', 'discordUrl', 'supportUrl', 'announcementBanner'] as const;
      for (const f of stringFields) allowed[f] = cleanString(data[f], 500);
      allowed.announcementBannerActive = cleanBool(data.announcementBannerActive);

      await store.mutate((d) => {
        for (const [k, v] of Object.entries(allowed)) {
          (d.content as unknown as Record<string, unknown>)[k] = v;
        }
      });
      await logAudit(store, user, 'update', 'site_content', 'Site content updated', ctx.request);
      return ok();
    }

    throw new ApiError(400, 'bad_action', 'Unknown action.');
  } catch (error) {
    return fail(error);
  }
};
