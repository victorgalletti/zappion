// SPDX-License-Identifier: AGPL-3.0-only
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../_shared/supabase.ts";

/** Null means unrestricted; an empty result must be denied, never passed to tools. */
export async function keyAllowedAccounts(
  supabase: SupabaseClient<Database>,
  orgId: string,
  addresses: string[] | null,
  headerAccounts: string[],
): Promise<string[] | null> {
  if (addresses === null) return headerAccounts.length ? headerAccounts : null;
  if (!addresses.length) return [];

  // Addresses are Meta account IDs, whereas MCP allowlists contain phone numbers.
  const { data, error } = await supabase.from("organizations_addresses")
    .select("phone:extra->>phone_number")
    .eq("organization_id", orgId)
    .eq("service", "whatsapp")
    .in("address", addresses);
  if (error) throw new Error(error.message);
  const phones = (data ?? []).map((row) => row.phone).filter(
    (phone): phone is string =>
      typeof phone === "string" && /^\d+$/.test(phone),
  );
  return [...new Set(phones)].filter((phone) =>
    !headerAccounts.length || headerAccounts.includes(phone)
  );
}
