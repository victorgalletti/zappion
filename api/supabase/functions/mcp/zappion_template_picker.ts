// SPDX-License-Identifier: AGPL-3.0-only
import type { SupabaseClient } from "@supabase/supabase-js";
import { contactName, type Database } from "../_shared/supabase.ts";
import { listTemplates } from "../whatsapp-management/templates.ts";
import { normalizePhone, resolveAccount } from "./tools.ts";
import { getServiceWindow } from "./zappion_get_service_window.ts";

interface TemplatePickerParams {
  supabase: SupabaseClient<Database>;
  orgId: string;
  contactPhone: string;
  accountPhone?: string;
  templateName?: string;
  allowedAccounts: string[];
  allowedContacts: string[];
}

/**
 * What the template picker screen needs: the contact, the service window and
 * the account's approved templates with their components, so the screen can
 * ask for each variable and preview the message without another call.
 */
export async function templatePicker(params: TemplatePickerParams) {
  // Checks the contact allowlist and resolves the account.
  const window = await getServiceWindow(params);
  const account = await resolveAccount({
    supabase: params.supabase,
    orgId: params.orgId,
    accountPhone: window.account_phone,
    allowedAccounts: params.allowedAccounts,
  });

  const [{ data: contactRow }, { data: templates }] = await Promise.all([
    params.supabase
      .from("contacts_addresses")
      .select("extra")
      .eq("organization_id", params.orgId)
      .eq("organization_address", account.address)
      .eq("service", "whatsapp")
      .eq("address", window.contact_phone)
      .maybeSingle()
      .throwOnError(),
    listTemplates(params.supabase, params.orgId, account.address),
  ]);

  const wanted = params.templateName?.trim().toLowerCase();

  return {
    account: { name: account.name, phone: account.phone },
    contact: {
      name: contactName(contactRow?.extra),
      phone: normalizePhone(window.contact_phone),
    },
    service_window: window.status,
    closes_at: window.closes_at,
    selected: wanted &&
        templates.some((t) => t.name.toLowerCase() === wanted)
      ? wanted
      : null,
    templates: templates
      .filter((t) => t.status === "APPROVED")
      .map((t) => ({
        id: t.id,
        name: t.name,
        language: t.language,
        category: t.category,
        parameter_format:
          (t as { parameter_format?: string }).parameter_format ??
            "POSITIONAL",
        components: t.components,
      })),
  };
}
