/**
 * Internal owner notifications.
 *
 * Important system events (new purchase, refund, license generated, webhook
 * errors…) are recorded here and shown in the admin panel. This is the
 * site's own notification channel — it does not depend on any external
 * service.
 */
import type { Notification } from '../types';
import type { Store } from './store';

const MAX_NOTIFICATIONS = 300;

function randomId(): string {
  return [...crypto.getRandomValues(new Uint8Array(9))].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function notify(
  store: Store,
  type: Notification['type'],
  title: string,
  message: string,
): Promise<void> {
  const entry: Notification = {
    id: randomId(),
    type,
    title,
    message,
    createdAt: new Date().toISOString(),
    read: false,
  };
  return store.mutate((db) => {
    db.notifications.push(entry);
    db.notifications = db.notifications.slice(-MAX_NOTIFICATIONS);
  });
}

export function unreadNotificationCount(db: { notifications: Notification[] }): number {
  return db.notifications.filter((n) => !n.read).length;
}
