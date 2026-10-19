// SPDX-License-Identifier: AGPL-3.0-only
import type { ContactAddressRow } from "./types";

/** Match the API: address book, organization-saved name, then push name. */
export function contactName(extra: ContactAddressRow["extra"] | undefined): string | undefined {
  return extra?.synced?.name ?? extra?.saved_name ?? extra?.name;
}
