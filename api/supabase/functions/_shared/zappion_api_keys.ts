// SPDX-License-Identifier: AGPL-3.0-only
// Zappion: API keys are stored as their hex SHA-256 (public.api_keys.key_hash),
// the same as public.zappion_hash_api_key in Postgres.
export async function hashApiKey(key: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(key),
  );

  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
