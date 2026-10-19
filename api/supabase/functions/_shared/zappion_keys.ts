// SPDX-License-Identifier: AGPL-3.0-only
// Supabase API keys for the Edge Functions, new format first.
//
// Projects created since November 2025 only have the new keys, which the
// runtime injects as JSON dictionaries keyed by name: SUPABASE_SECRET_KEYS
// (sb_secret_..., bypasses RLS) and SUPABASE_PUBLISHABLE_KEYS
// (sb_publishable_...). The legacy SUPABASE_SERVICE_ROLE_KEY and
// SUPABASE_ANON_KEY are what older projects and the local CLI still inject,
// so they remain the fallback until Supabase removes them.

function keysFrom(name: string): string[] {
  const raw = Deno.env.get(name);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const keys = Object.entries(parsed)
      .sort(([a], [b]) => (a === "default" ? -1 : b === "default" ? 1 : 0))
      .map(([, value]) => value)
      .filter((value): value is string => typeof value === "string" && !!value);
    return keys;
  } catch {
    return [];
  }
}

function legacy(name: string): string[] {
  const value = Deno.env.get(name);
  return value ? [value] : [];
}

/** Every key that bypasses RLS: the new secret keys, then the legacy service role key. */
export function secretKeys(): string[] {
  return [
    ...keysFrom("SUPABASE_SECRET_KEYS"),
    ...legacy("SUPABASE_SERVICE_ROLE_KEY"),
  ];
}

/** The key for server-side clients that bypass RLS (`default` secret key first). */
export function secretKey(): string {
  const key = secretKeys()[0];
  if (!key) {
    throw new Error(
      "Undefined SUPABASE_SECRET_KEYS and SUPABASE_SERVICE_ROLE_KEY env vars.",
    );
  }
  return key;
}

/** The key for clients that act as a user or an org API key (RLS applies). */
export function publishableKey(): string {
  const key = [
    ...keysFrom("SUPABASE_PUBLISHABLE_KEYS"),
    ...legacy("SUPABASE_ANON_KEY"),
  ][0];
  if (!key) {
    throw new Error(
      "Undefined SUPABASE_PUBLISHABLE_KEYS and SUPABASE_ANON_KEY env vars.",
    );
  }
  return key;
}

/**
 * Whether a bearer token is one of the project's secret keys: how the
 * database's triggers and cron jobs (Vault `edge_functions_token`) prove they
 * are internal callers. Accepts both formats so the Vault secret can be
 * either while a project moves from the legacy keys to the new ones.
 */
export function isSecretKey(token: string | null | undefined): boolean {
  return !!token && secretKeys().includes(token);
}
