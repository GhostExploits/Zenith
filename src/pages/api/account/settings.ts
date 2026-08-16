import type { APIRoute } from 'astro';
import { ApiError, fail, readPayload, redirectTo, requireSameOrigin, requireUser } from '../../../lib/server/api';
import { hashPassword, verifyPassword } from '../../../lib/server/auth';
import { logActivity } from '../../../lib/server/activity';

export const POST: APIRoute = async (ctx) => {
  try {
    requireSameOrigin(ctx);
    const { user, store } = await requireUser(ctx);
    const payload = await readPayload(ctx);

    const displayName = typeof payload.displayName === 'string' ? payload.displayName.trim().slice(0, 40) : '';
    const currentPassword = typeof payload.currentPassword === 'string' ? payload.currentPassword : '';
    const newPassword = typeof payload.newPassword === 'string' ? payload.newPassword : '';

    const now = new Date().toISOString();
    const changes: string[] = [];

    if (displayName && displayName !== user.displayName) {
      await store.mutate((db) => {
        const u = db.users.find((x) => x.id === user.id);
        if (u) {
          u.displayName = displayName;
          u.updatedAt = now;
        }
      });
      changes.push('display name');
    }

    if (newPassword) {
      // Accounts created via Google have no password yet — setting the first
      // one does not require the (nonexistent) current password.
      const hasPassword = user.passwordHash.length > 0;
      if (hasPassword && !currentPassword) {
        throw new ApiError(400, 'wrong_password', 'Enter your current password.');
      }
      if (hasPassword && !(await verifyPassword(currentPassword, user))) {
        throw new ApiError(400, 'wrong_password', 'Your current password is incorrect.');
      }
      if (newPassword.length < 8) throw new ApiError(400, 'weak_password', 'New password must be at least 8 characters.');
      const { hash, salt, iterations } = await hashPassword(newPassword);
      await store.mutate((db) => {
        const u = db.users.find((x) => x.id === user.id);
        if (u) {
          u.passwordHash = hash;
          u.salt = salt;
          u.iterations = iterations;
          u.updatedAt = now;
        }
        // Keep the current session, drop all others.
        const currentToken = ctx.request.headers.get('cookie') ?? '';
        db.sessions = db.sessions.filter((s) => s.userId !== user.id || currentToken.includes(s.id));
      });
      changes.push('password');
      await logActivity(store, user.id, 'password_change', 'Password was changed.', ctx.request);
    }

    if (changes.length > 0) {
      await logActivity(store, user.id, 'settings_change', `Updated ${changes.join(' and ')}.`, ctx.request);
      return redirectTo(ctx, '/account/settings?saved=1');
    }
    return redirectTo(ctx, '/account/settings');
  } catch (error) {
    if (error instanceof ApiError) {
      return redirectTo(ctx, `/account/settings?error=${encodeURIComponent(error.code)}`);
    }
    return fail(error);
  }
};
