/**
 * Server-rendered page guards. Authorization is enforced here on the server —
 * these pages never render for unauthorized users.
 *
 * Astro requires redirects to be returned from the page component itself, so
 * these helpers return `PageSession | Response`. Every guarded page does:
 *
 *   const session = await requireUser(Astro);
 *   if (session instanceof Response) return session;
 *   const { user, store } = session;
 */
import type { AstroGlobal } from 'astro';
import type { User } from '../types';
import type { Store } from './store';
import { getSessionUser } from './auth';
import { getStore } from './store';

export interface PageSession {
  user: User;
  store: Store;
}

/** Returns the signed-in user + store, or null (caller redirects). */
export async function getPageSession(astro: AstroGlobal): Promise<PageSession | null> {
  let store: Store;
  try {
    store = await getStore();
  } catch {
    return null;
  }
  let user: User | null = null;
  try {
    user = await getSessionUser(store, astro.request);
  } catch {
    user = null;
  }
  if (!user) return null;
  return { user, store };
}

/** Require a signed-in user, else return a redirect to sign-in (page must return it). */
export async function requireUser(astro: AstroGlobal): Promise<PageSession | Response> {
  const session = await getPageSession(astro);
  if (!session) {
    return astro.redirect(`/auth/signin?next=${encodeURIComponent(astro.url.pathname)}`);
  }
  return session;
}

/** Require an administrator (admin or owner), else return a redirect to the account area. */
export async function requireAdmin(astro: AstroGlobal): Promise<PageSession | Response> {
  const session = await requireUser(astro);
  if (session instanceof Response) return session;
  if (session.user.role !== 'admin' && session.user.role !== 'owner') {
    return astro.redirect('/account');
  }
  return session;
}
