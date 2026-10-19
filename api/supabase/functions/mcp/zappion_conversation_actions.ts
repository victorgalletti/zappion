// SPDX-License-Identifier: AGPL-3.0-only
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../_shared/supabase.ts";
import { normalizePhone, resolveAccount } from "./tools.ts";

interface ConversationActionParams {
  supabase: SupabaseClient<Database>;
  orgId: string;
  contactPhone: string;
  accountPhone?: string;
  allowedAccounts: string[];
  allowedContacts: string[];
}

async function resolveTarget(params: ConversationActionParams) {
  const contactPhone = normalizePhone(params.contactPhone);
  if (
    params.allowedContacts.length &&
    !params.allowedContacts.includes(contactPhone)
  ) {
    throw new Error(
      `Contact ${contactPhone} is not allowed. Allowed contacts: ${
        params.allowedContacts.join(", ")
      }`,
    );
  }
  const account = await resolveAccount({
    supabase: params.supabase,
    orgId: params.orgId,
    accountPhone: params.accountPhone
      ? normalizePhone(params.accountPhone)
      : undefined,
    allowedAccounts: params.allowedAccounts,
  });
  return { contactPhone, account };
}

export async function markConversationRead(params: ConversationActionParams) {
  const { contactPhone, account } = await resolveTarget(params);
  // Only identifiers are needed; customer message content never drives actions.
  const { data: message } = await params.supabase.from("messages")
    .select("id")
    .eq("organization_id", params.orgId)
    .eq("service", "whatsapp")
    .eq("organization_address", account.address)
    .eq("conversation_address", contactPhone)
    .not("sender_address", "is", null)
    .order("timestamp", { ascending: false })
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle()
    .throwOnError();

  if (!message) return { marked_message_id: null };

  await params.supabase.rpc("mark_read", {
    p_message_id: message.id,
    p_typing: false,
  }).throwOnError();
  return { marked_message_id: message.id };
}

export async function setConversationArchived(
  params: ConversationActionParams,
  archived: boolean,
) {
  const { contactPhone, account } = await resolveTarget(params);
  const { data: conversation } = await params.supabase.from("conversations")
    .select("id")
    .eq("organization_id", params.orgId)
    .eq("service", "whatsapp")
    .eq("organization_address", account.address)
    .eq("address", contactPhone)
    // Same pick as fetch_conversation when a contact has several.
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()
    .throwOnError();

  if (!conversation) throw new Error("Conversation not found.");

  await params.supabase.rpc("zappion_mcp_set_archived", {
    p_organization_id: params.orgId,
    p_conversation_id: conversation.id,
    p_archived: archived,
  }).throwOnError();
  return { archived };
}
