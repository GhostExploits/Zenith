/**
 * Cloudflare runtime bindings.
 *
 * The Astro Cloudflare adapter exposes bindings (D1, R2, KV…) at
 * `context.locals.runtime.env` on every server-rendered request. Domain code
 * (store, storage, payments) needs those bindings but has no Astro context,
 * so middleware captures the runtime here at the start of each request.
 *
 * Bindings are typed structurally on purpose — no @cloudflare/workers-types
 * dependency is required.
 */

// ---------------------------------------------------------------------------
// Minimal structural types for the bindings Zenith uses
// ---------------------------------------------------------------------------

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  run(): Promise<{ meta: { changes: number; last_row_id?: number } }>;
  first<T = unknown>(): Promise<T | null>;
  all<T = unknown>(): Promise<{ results: T[] }>;
}

export interface D1DatabaseLike {
  prepare(sql: string): D1PreparedStatement;
  exec?(sql: string): Promise<unknown>;
  batch?(statements: D1PreparedStatement[]): Promise<unknown[]>;
}

export interface R2ObjectLike {
  key: string;
  size: number;
  body: ReadableStream | null;
}

export interface R2BucketLike {
  get(key: string): Promise<R2ObjectLike | null>;
  put(
    key: string,
    data: ArrayBuffer | Uint8Array | ReadableStream | string,
    options?: { httpMetadata?: { contentType?: string } },
  ): Promise<unknown>;
  delete(key: string): Promise<void>;
}

export interface CloudflareEnv {
  /** D1 database binding (production store). */
  DB?: D1DatabaseLike;
  /** R2 bucket binding (private release files). */
  STORAGE?: R2BucketLike;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Runtime capture
// ---------------------------------------------------------------------------

let runtimeEnv: CloudflareEnv | null = null;

/** Called by middleware at the start of every request. */
export function setRuntimeEnv(env: unknown): void {
  runtimeEnv = (env ?? null) as CloudflareEnv | null;
}

export function getRuntimeEnv(): CloudflareEnv | null {
  return runtimeEnv;
}

/** The D1 binding, or null when the production database is not bound. */
export function getD1(): D1DatabaseLike | null {
  return runtimeEnv?.DB ?? null;
}

/** The R2 binding, or null when private release storage is not bound. */
export function getR2(): R2BucketLike | null {
  return runtimeEnv?.STORAGE ?? null;
}
