// SPDX-License-Identifier: AGPL-3.0-only
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../_shared/supabase.ts";
import { normalizePhone, resolveAccount } from "./tools.ts";
import { readServiceWindow } from "./zappion_service_window.ts";

interface GetServiceWindowParams {
  supabase: SupabaseClient<Database>;
  orgId: string;
  contactPhone: string;
  accountPhone?: string;
  allowedAccounts: string[];
  allowedContacts: string[];
}

export async function getServiceWindow(params: GetServiceWindowParams) {
  const contactPhone = normalizePhone(params.contactPhone);
  const accountPhone = params.accountPhone
    ? normalizePhone(params.accountPhone)
    : undefined;

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
    accountPhone,
    allowedAccounts: params.allowedAccounts,
  });
  const window = await readServiceWindow({
    supabase: params.supabase,
    orgId: params.orgId,
    accountAddress: account.address,
    contactPhone,
  });

  return {
    contact_phone: contactPhone,
    account_phone: account.phone,
    ...window,
    can_send: window.status === "open"
      ? ["text", "media", "location", "contacts", "reaction", "template"]
      : ["template"],
  };
}
