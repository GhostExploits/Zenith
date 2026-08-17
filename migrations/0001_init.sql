-- Zenith D1 schema — initial migration.
--
-- The application persists its entire domain document in one row of this
-- table. Reads are a single SELECT; writes are a compare-and-swap UPDATE so
-- concurrent worker isolates never lose an update. This keeps the store
-- interface (`db()` + `mutate()`) synchronous for page code while the real
-- database lives on Cloudflare D1.
--
-- Apply with:
--   npm run db:migrate          (remote, against your production D1 database)
--   wrangler d1 execute zenith --local --file=migrations/0001_init.sql   (local preview)

CREATE TABLE IF NOT EXISTS store (
  key TEXT PRIMARY KEY,
  doc TEXT NOT NULL,
  rev INTEGER NOT NULL
);
