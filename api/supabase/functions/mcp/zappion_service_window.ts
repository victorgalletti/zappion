// SPDX-License-Identifier: AGPL-3.0-only
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../_shared/supabase.ts";

const SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Pure time calculation; the window is closed at exactly 24 hours. */
export function calculateServiceWindow(
  lastIncomingAt: string | null,
  nowMs = Date.now(),
) {
  if (lastIncomingAt === null) {
    return {
      status: "closed" as const,
      last_incoming_at: null,
      closes_at: null,
      remaining_minutes: null,
    };
  }

  const incomingMs = new Date(lastIncomingAt).getTime();
  const closesMs = incomingMs + SERVICE_WINDOW_MS;
  const remainingMs = closesMs - nowMs;

  return {
    status: remainingMs > 0 ? "open" as const : "closed" as const,
    last_incoming_at: new Date(incomingMs).toISOString(),
    closes_at: new Date(closesMs).toISOString(),
    remaining_minutes: Math.max(0, Math.floor(remainingMs / (60 * 1000))),
  };
}

export interface ServiceWindowParams {
  supabase: SupabaseClient<Database>;
  orgId: string;
  accountAddress: string;
  contactPhone: string;
}

/** Read only the latest incoming timestamp using the caller's RLS client. */
export async function readServiceWindow(params: ServiceWindowParams) {
  const { data: lastIncoming } = await params.supabase
    .from("messages")
    .select("timestamp")
    .eq("organization_id", params.orgId)
    .eq("organization_address", params.accountAddress)
    .eq("conversation_address", params.contactPhone)
    .not("sender_address", "is", null)
    .order("timestamp", { ascending: false })
    .limit(1)
    .maybeSingle()
    .throwOnError();

  return calculateServiceWindow(lastIncoming?.timestamp ?? null);
}
