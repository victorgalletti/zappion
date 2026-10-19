// Instagram helpers shared by the webhook and the dispatcher.
import type { SupabaseClient } from "@supabase/supabase-js";
import * as log from "./logger.ts";

/**
 * Flags a connection whose token proved dead (Graph error 190) so the UI can
 * prompt a re-login — the same `extra.needs_reauth` flag the refresh sweep
 * sets on a failed refresh (and clears on success). Detection matters outside
 * the sweep: the sweep only attempts tokens within 10 days of expiry, so a
 * token revoked mid-life (password change, forced session invalidation)
 * would otherwise fail silently for weeks. merge_update keeps the rest of
 * extra.
 */
export async function flagNeedsReauth(
  client: SupabaseClient,
  organization_id: string,
  address: string,
): Promise<void> {
  log.error(
    `Instagram token dead for ${address}; flagging needs_reauth`,
  );

  await client
    .from("organizations_addresses")
    .update({ extra: { needs_reauth: new Date().toISOString() } })
    .eq("organization_id", organization_id)
    .eq("service", "instagram")
    .eq("address", address)
    .throwOnError();
}
