// SPDX-License-Identifier: AGPL-3.0-only
import { formatPhone } from "./messages";
import type { OrganizationAddressRow } from "./types";

export function instanceName(instance: OrganizationAddressRow) {
  return instance.extra?.label || instance.extra?.verified_name || formatPhone(instance.extra?.phone_number ?? instance.address);
}
