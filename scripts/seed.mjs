/**
 * Reset the development database.
 *
 * Deletes data/db.json and the placeholder release storage. A fresh seeded
 * database (owner account + demo catalog + placeholder release files) is
 * created automatically on the next request that touches the store
 * (sign-in, account page, admin page, any API route).
 *
 * Development only — never run against a production backend.
 */
import { rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dataDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'data');
rmSync(dataDir, { recursive: true, force: true });

console.log('Deleted ./data — the development database and release storage.');
console.log('A fresh seeded database will be created on the next request (npm run dev, then sign in).');
