import type { AccountActivity, AuditEntry, DbDocument, User } from '../types';
import type { Store } from './store';

function randomId(): string {
  return [...crypto.getRandomValues(new Uint8Array(9))].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Record user-facing account activity (shown in the account overview). */
export function logActivity(
  store: Store,
  userId: string,
  type: AccountActivity['type'],
  message: string,
  request?: Request,
): Promise<void> {
  const entry: AccountActivity = {
    id: randomId(),
    userId,
    type,
    message,
    createdAt: new Date().toISOString(),
    ip: request?.headers.get('cf-connecting-ip') ?? undefined,
  };
  return store.mutate((db: DbDocument) => {
    db.activity.push(entry);
    db.activity = db.activity.slice(-200);
  });
}

/** Record an administrative action (visible in the admin audit log). */
export function logAudit(store: Store, actor: User, action: string, resource: string, details?: string, request?: Request): Promise<void> {
  const entry: AuditEntry = {
    id: randomId(),
    actorId: actor.id,
    actorEmail: actor.email,
    action,
    resource,
    details,
    createdAt: new Date().toISOString(),
    ip: request?.headers.get('cf-connecting-ip') ?? undefined,
  };
  return store.mutate((db: DbDocument) => {
    db.audit.push(entry);
    db.audit = db.audit.slice(-500);
  });
}
