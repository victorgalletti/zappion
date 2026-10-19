// SPDX-License-Identifier: AGPL-3.0-only
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import {
  contactName,
  type Database,
  type WhatsAppContactAddressExtra,
} from "../_shared/supabase.ts";
import { normalizePhone, resolveAccount } from "./tools.ts";

export const contactNameInput = z.string().trim().min(1).max(100);

interface UpdateContactParams {
  supabase: SupabaseClient<Database>;
  orgId: string;
  contactPhone: string;
  accountPhone?: string;
  name: string;
  allowedAccounts: string[];
  allowedContacts: string[];
}

export async function updateContact(params: UpdateContactParams) {
  const name = contactNameInput.parse(params.name);
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
  const key = {
    organization_id: params.orgId,
    organization_address: account.address,
    service: "whatsapp" as const,
    address: contactPhone,
  };
  const { data: existing } = await params.supabase
    .from("contacts_addresses")
    .select("extra")
    .match(key)
    .maybeSingle()
    .throwOnError();

  const extra = existing?.extra as
    | WhatsAppContactAddressExtra
    | null
    | undefined;
  if (extra?.synced?.action === "add") {
    throw new Error(
      "This contact's name comes from the WhatsApp Business app address book and must be changed there.",
    );
  }

  // set_extra merges this patch; never copy customer metadata into a write.
  const query = existing
    ? params.supabase.from("contacts_addresses").update({
      extra: { saved_name: name },
    })
      .match(key)
    : params.supabase.from("contacts_addresses").insert({
      ...key,
      extra: { saved_name: name },
    });
  const { data: contact } = await query
    .select("extra")
    .single()
    .throwOnError();

  return { contact: { phone: contactPhone, name: contactName(contact.extra) } };
}
